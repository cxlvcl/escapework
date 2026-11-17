import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./helpers";

test("PHP MySQL backend work-day and statistics regressions (isolated SQLite adapter)", async (t) => {
  const php = process.env.ESCAPE_PHP_BIN || "php";
  const available = spawnSync(php, [
    "-r",
    "exit(extension_loaded('sqlite3') ? 0 : 1);",
  ]);
  if (available.error || available.status !== 0) {
    if (process.env.ESCAPE_PHP_BIN)
      assert.fail("ESCAPE_PHP_BIN must provide PHP with sqlite3");
    t.skip("Set ESCAPE_PHP_BIN to PHP 8.3+ with sqlite3");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "escape-workday-sql-"));
  try {
    const f = fixture();
    for (const [i, role] of (["sous_chef", "cook"] as const).entries()) {
      const id = randomUUID();
      const token = i === 0 ? "manager" : "cook";
      f.db.users.push({
        id,
        name: token,
        login: token,
        password_hash: "unused",
        role,
        active_station_id: null,
      });
      f.db.sessions.push({
        user_id: id,
        token_hash: f.deps.hash(token),
        expires_at: "2099-01-01T00:00:00.000Z",
      });
    }
    const photoBase64 = (
      await sharp({
        create: { width: 20, height: 20, channels: 3, background: "#aaa" },
      })
        .webp()
        .toBuffer()
    ).toString("base64");
    const input = join(directory, "fixture.json");
    const photosBase64 = await Promise.all(
      ["red", "blue", "green", "yellow"].map(async (background) =>
        (
          await sharp({
            create: { width: 20, height: 20, channels: 3, background },
          })
            .webp()
            .toBuffer()
        ).toString("base64"),
      ),
    );
    writeFileSync(
      input,
      JSON.stringify({
        tables: f.db,
        photoBase64,
        photosBase64,
        photoDir: join(directory, "photos"),
      }),
    );
    const result = spawnSync(php, ["tests/mysql-workday.php", input], {
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /PHP missed-day recovery/);
    assert.match(result.stdout, /PHP legacy-night repair/);
    assert.match(result.stdout, /PHP multiple photos/);
    assert.match(result.stdout, /PHP photo archive/);
    t.diagnostic(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
