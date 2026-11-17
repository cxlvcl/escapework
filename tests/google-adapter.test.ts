import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { readFileSync } from "node:fs";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "../lib/password";
import { emptyTables, schema, tableNames } from "../google/src/schema";
import { legacyColumns } from "../google/src/migration";
import type { ApiResult } from "../types/models";
import { dateOffset, workDate } from "../lib/domain";
import sharp from "sharp";
import type { Kitchen } from "../types/models";
// Runs the exact bundled Apps Script entry points with Google services replaced by deterministic adapters.
// No Node Buffer/TextEncoder/crypto globals are exposed to the bundle.
test("bundled GAS verifies HMAC, runs scrypt in V8, commits atomically with raw cells and preserves bootstrap", async () => {
  const tables = emptyTables();
  const rows = new Map<string, unknown[][]>(
    tableNames.map((t) => [t, [[...schema[t]]]]),
  );
  const secret = randomBytes(32).toString("hex");
  const props = new Map([
    ["GOOGLE_API_SECRET", secret],
    ["SPREADSHEET_ID", "test-sheet"],
    ["PHOTO_FOLDER_ID", "test-folder"],
    ["BOOTSTRAP_ENABLED", "true"],
  ]);
  let failCommit = false;
  let failAfterCommit = false;
  const files = new Map<string, { bytes: number[]; trashed: boolean }>();
  let lockHeld = false;
  const signature = (payload: string) =>
    createHmac("sha256", secret).update(payload).digest("hex");
  const sandbox = {
    console: { error: () => {} },
    Uint8Array,
    Uint32Array,
    Int32Array,
    ArrayBuffer,
    DataView,
    Date,
    Intl,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k) ?? null,
        deleteProperty: (k: string) => props.delete(k),
      }),
    },
    Utilities: {
      getUuid: randomUUID,
      Charset: { UTF_8: "utf8" },
      DigestAlgorithm: { SHA_256: "sha256" },
      newBlob: (s: string | number[]) => ({
        getBytes: () => [...Buffer.from(s)],
      }),
      base64Decode: (s: string) => [...Buffer.from(s, "base64")],
      base64Encode: (bytes: number[]) => Buffer.from(bytes).toString("base64"),
      computeHmacSha256Signature: (s: string, k: string) => [
        ...createHmac("sha256", k).update(s).digest(),
      ],
      computeDigest: (_: unknown, s: string) => [
        ...createHash("sha256").update(s).digest(),
      ],
    },
    DriveApp: {
      Access: { PRIVATE: "private" },
      getFolderById: () => ({
        getSharingAccess: () => "private",
        createFile: (blob: { getBytes(): number[] }) => {
          const id = randomUUID();
          files.set(id, { bytes: blob.getBytes(), trashed: false });
          return {
            getId: () => id,
            getSharingAccess: () => "private",
            setTrashed: (value: boolean) => {
              files.get(id)!.trashed = value;
            },
          };
        },
      }),
      getFileById: (id: string) => ({
        isTrashed: () => files.get(id)!.trashed,
        getBlob: () => ({ getBytes: () => files.get(id)!.bytes }),
        setTrashed: (value: boolean) => {
          files.get(id)!.trashed = value;
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => {
          assert.equal(lockHeld, false);
          lockHeld = true;
        },
        tryLock: () => {
          assert.equal(lockHeld, false);
          lockHeld = true;
          return true;
        },
        releaseLock: () => {
          lockHeld = false;
        },
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s: string) => ({ setMimeType: () => s }),
    },
    SpreadsheetApp: {
      flush: () => {},
      openById: () => ({
        setSpreadsheetTimeZone: () => {},
        getSheetByName: (name: string) => ({
          getLastRow: () => rows.get(name)!.length,
          getLastColumn: () => rows.get(name)![0].length,
          getRange: () => ({ getValues: () => [rows.get(name)![0]] }),
        }),
      }),
    },
    Sheets: {
      Spreadsheets: {
        Values: {
          batchGet: (_id: string, { ranges }: { ranges: string[] }) => ({
            valueRanges: ranges.map((range) => ({
              values: rows.get(range.split("'")[1]),
            })),
          }),
        },
        get: () => ({
          sheets: tableNames.map((title, sheetId) => ({
            properties: { title, sheetId, gridProperties: { rowCount: 1000 } },
          })),
        }),
        batchUpdate: ({
          requests,
        }: {
          requests: {
            updateCells?: {
              range: { sheetId: number };
              rows: {
                values: { userEnteredValue: Record<string, unknown> }[];
              }[];
            };
          }[];
        }) => {
          assert.equal(
            lockHeld,
            true,
            "snapshot recovery must commit under the script lock",
          );
          if (failCommit) throw new Error("Google unavailable");
          const copy = new Map(rows);
          for (const req of requests) {
            if (req.updateCells) {
              const update = req.updateCells;
              const values = update.rows.map((row) =>
                row.values.map(
                  (cell) =>
                    cell.userEnteredValue.stringValue ??
                    cell.userEnteredValue.numberValue ??
                    cell.userEnteredValue.boolValue ??
                    null,
                ),
              );
              copy.set(tableNames[update.range.sheetId], values);
            }
          }
          rows.clear();
          for (const [key, val] of copy) rows.set(key, val);
          if (failAfterCommit) throw new Error("Lost commit response");
        },
      },
    },
  };
  const context = runInNewContext(
    readFileSync("google/dist/Code.js", "utf8") + "\n({doPost, setupDatabase})",
    sandbox,
  ) as { doPost(e: unknown): string; setupDatabase(): void };
  function call(
    action: string,
    data: Record<string, unknown> = {},
    token?: string,
    valid = true,
  ) {
    const payload = JSON.stringify({
      action,
      data,
      token,
      requestId: randomUUID(),
      timestamp: Date.now(),
    });
    return JSON.parse(
      context.doPost({
        postData: {
          contents: JSON.stringify({
            payload,
            signature: valid ? signature(payload) : "0".repeat(64),
          }),
        },
      }),
    ) as ApiResult;
  }
  assert.equal(call("getUsers", {}, undefined, false).success, false);
  const hash = await hashPassword("strong-test-password");
  assert.equal(
    call("bootstrap", { name: "Артем", login: "Артем", passwordHash: hash })
      .success,
    true,
  );
  assert.equal(props.has("BOOTSTRAP_ENABLED"), false);
  assert.equal(rows.get("users")!.length, 2);
  const token = randomBytes(32).toString("base64url");
  const login = call("login", {
    login: "Артем",
    password: "strong-test-password",
    sessionToken: token,
  });
  assert.equal(login.success, true, JSON.stringify(login));
  assert.equal(call("getUsers", {}, token).success, true);
  assert.equal(
    call(
      "createUser",
      {
        name: '=IMPORTXML("x")',
        login: "test",
        role: "chef",
        passwordHash: hash,
      },
      token,
    ).success,
    true,
  );
  assert.equal(rows.get("users")![2][1], '=IMPORTXML("x")');
  const before = JSON.stringify([...rows]);
  failCommit = true;
  assert.equal(
    call(
      "createUser",
      { name: "Missing", login: "missing", role: "cook", passwordHash: hash },
      token,
    ).success,
    false,
  );
  assert.equal(JSON.stringify([...rows]), before);
  assert.equal(lockHeld, false);
  assert.equal(Object.keys(tables).length, 15);
  for (const name of tableNames) {
    if (legacyColumns[name])
      rows.set(name, [
        legacyColumns[name]!,
        ...rows
          .get(name)!
          .slice(1)
          .map((row) => row.slice(0, legacyColumns[name]!.length)),
      ]);
  }
  const legacy = JSON.stringify([...rows]);
  assert.throws(() => context.setupDatabase());
  assert.equal(JSON.stringify([...rows]), legacy);
  assert.equal(lockHeld, false);
  failCommit = false;
  context.setupDatabase();
  for (const name of tableNames)
    assert.deepEqual(Array.from(rows.get(name)![0]), schema[name]);
  assert.equal(rows.get("additional_task_types")!.length, 11);
  assert.equal(call("getActivity", {}, token).success, true);
  const migrated = JSON.stringify([...rows]);
  context.setupDatabase();
  assert.equal(JSON.stringify([...rows]), migrated);
  const yesterday = dateOffset(workDate(), -1);
  const createdColumn = schema.station_tasks.indexOf("created_work_date");
  for (const row of rows.get("station_tasks")!.slice(1))
    row[createdColumn] = yesterday;
  const stats = call("getStatistics", { period: "yesterday" }, token);
  assert.equal(stats.success, true, JSON.stringify(stats));
  assert.equal(rows.get("daily_statistics")!.length, 2);
  assert.equal(rows.get("daily_statistics")![1][0], yesterday);
  assert.equal(rows.get("daily_station_statistics")!.length, 10);
  assert.equal(lockHeld, false);
  assert.equal(
    call(
      "createUser",
      { name: "Cook", login: "cook", role: "cook", passwordHash: hash },
      token,
    ).success,
    true,
  );
  const cookToken = randomBytes(32).toString("base64url");
  assert.equal(
    call("login", {
      login: "cook",
      password: "strong-test-password",
      sessionToken: cookToken,
    }).success,
    true,
  );
  const stationId = rows.get("stations")![1][0];
  assert.equal(
    call("shift", { action: "open", stationId }, cookToken).success,
    true,
  );
  const base64 = (
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .webp()
      .toBuffer()
  ).toString("base64");
  const body = {
    category: "station",
    id: rows.get("station_tasks")![1][0],
    mimeType: "image/webp",
    photosBase64: Array(4).fill(base64),
  };
  failCommit = true;
  assert.equal(call("complete", body, cookToken).success, false);
  assert.equal(
    [...files.values()].filter((file) => !file.trashed).length,
    0,
    "failed Sheets commit must clean every photo",
  );
  failCommit = false;
  failAfterCommit = true;
  assert.equal(call("complete", body, cookToken).success, false);
  assert.equal(
    [...files.values()].filter((file) => !file.trashed).length,
    4,
    "lost Sheets commit response must retain all committed photo references",
  );
  failAfterCommit = false;
  const completed = call("getKitchen", {}, cookToken);
  assert.ok(completed.success);
  const task = (completed.data as Kitchen).tasks[0];
  assert.equal(task.photoCount, 4);
  assert.equal(
    call(
      "getPhoto",
      { category: "station", id: task.photoId, index: 3 },
      cookToken,
    ).success,
    true,
  );
  props.set("GOOGLE_READ_ONLY", "true");
  rows.set("daily_statistics", [[...schema.daily_statistics]]);
  rows.set("daily_station_statistics", [[...schema.daily_station_statistics]]);
  const frozenGoogle = JSON.stringify([...rows]);
  assert.equal(
    call("getStatistics", { period: "yesterday" }, token).success,
    true,
  );
  assert.equal(JSON.stringify([...rows]), frozenGoogle);
  assert.equal(lockHeld, false);
});
