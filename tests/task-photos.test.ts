import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./helpers";
import { execute, counts, snapshot } from "../google/src/core";
import { photoPaths } from "../lib/task-photos";
import type { ApiResult, Kitchen, AdditionalView } from "../types/models";

function setup() {
  const f = fixture();
  for (const [index, role] of (
    ["sous_chef", "cook", "cook"] as const
  ).entries()) {
    const id = randomUUID();
    f.db.users.push({
      id,
      role,
      name: String(index),
      login: String(index),
      password_hash: "unused",
      active_station_id: index === 1 ? f.db.stations[0].id : null,
    });
    f.db.sessions.push({
      user_id: id,
      token_hash: f.deps.hash(String(index)),
      expires_at: "2099-01-01T00:00:00.000Z",
    });
  }
  const call = (
    action: string,
    data: Record<string, unknown> = {},
    user = 1,
    requestId = randomUUID(),
  ) => execute(f.db, f.deps, { action, data, token: String(user), requestId });
  return { ...f, call };
}
function value<T>(result: ApiResult): T {
  assert.ok(result.success, JSON.stringify(result));
  return result.data as T;
}
async function images() {
  return Promise.all(
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
}

test("four photos retain order and parent permissions in all categories, with one completion per task", async () => {
  const f = setup(),
    photosBase64 = await images();
  value(
    f.call(
      "assignAdditional",
      { typeId: f.db.additional_task_types[0].id, userIds: [f.db.users[1].id] },
      0,
    ),
  );
  const targets = [
    {
      category: "station",
      id: f.db.station_tasks[0].id,
      table: "station_task_completions" as const,
    },
    {
      category: "refrigerator",
      id: f.db.refrigerator_tasks[0].id,
      table: "refrigerator_task_completions" as const,
    },
    {
      category: "additional",
      id: f.db.additional_tasks[0].id,
      table: "additional_tasks" as const,
    },
  ];
  for (const { category, id, table } of targets) {
    const body = { category, id, mimeType: "image/webp", photosBase64 };
    const requestId = randomUUID();
    value(f.call("complete", body, 1, requestId));
    value(f.call("complete", body, 1, requestId));
    const records = f.db[table];
    assert.equal(records.length, 1);
    const row = records[0];
    assert.equal(photoPaths(row.photo_path).length, 4);
    for (const [index, base64] of photosBase64.entries()) {
      const data = { category, id: row.id, index };
      assert.equal(
        value<{ base64: string }>(f.call("getPhoto", data)).base64,
        base64,
      );
      assert.equal(
        value<{ base64: string }>(f.call("getPhoto", data, 0)).base64,
        base64,
      );
      assert.equal(f.call("getPhoto", data, 2).success, false);
    }
    assert.equal(
      value<{ base64: string }>(f.call("getPhoto", { category, id: row.id }))
        .base64,
      photosBase64[0],
    );
    for (const index of [-1, 4, 0.5, "1"])
      assert.equal(
        f.call("getPhoto", { category, id: row.id, index }).success,
        false,
      );
    assert.equal(
      f.call(
        "complete",
        { ...body, photosBase64: [...photosBase64].reverse() },
        1,
        requestId,
      ).success,
      false,
    );
  }
  assert.equal(f.files.size, 12);
  const kitchen = value<Kitchen>(f.call("getKitchen"));
  const additional = value<AdditionalView>(f.call("getAdditional"));
  for (const task of [
    kitchen.tasks[0],
    kitchen.fridges[0],
    additional.tasks[0],
  ]) {
    assert.equal(task.photoCount, 4);
    assert.equal("photo_path" in task, false);
  }
  assert.equal(counts(f.db, "2026-09-06").overall.completed, 3);
  f.setTime(new Date("2026-09-07T01:00:00Z"));
  snapshot(f.db, f.deps);
  assert.equal(f.db.daily_statistics[0].completed_tasks, 3);
  assert.equal(value<Kitchen>(f.call("getKitchen")).tasks[0].photoCount, 0);
  assert.equal(
    f.call("getPhoto", {
      category: "station",
      id: f.db.station_task_completions[0].id,
      index: 3,
    }).success,
    false,
  );
});

test("zero, five, malformed or partially failing photo sets never complete a task or leave saved files", async () => {
  const f = setup(),
    photos = await images();
  const body = {
    category: "station",
    id: f.db.station_tasks[0].id,
    mimeType: "image/webp",
  };
  for (const photosBase64 of [
    [],
    [...photos, photos[0]],
    "not an array",
    null,
    [photos[0], 5],
  ]) {
    assert.equal(f.call("complete", { ...body, photosBase64 }).success, false);
    assert.equal(f.files.size, 0);
  }
  assert.equal(f.call("complete", body).success, false);
  assert.equal(
    f.call("complete", {
      ...body,
      photosBase64: photos,
      photoBase64: photos[0],
    }).success,
    false,
  );
  assert.throws(() =>
    f.call("complete", { ...body, photosBase64: [photos[0], "broken WebP"] }),
  );
  assert.equal(f.files.size, 0);
  const save = f.deps.savePhoto;
  let saves = 0;
  f.deps.savePhoto = (bytes, name) => {
    if (++saves === 3) throw new Error("Storage unavailable");
    return save(bytes, name);
  };
  assert.throws(() => f.call("complete", { ...body, photosBase64: photos }));
  assert.equal(f.files.size, 0);
  assert.equal(f.db.station_task_completions.length, 0);
  assert.equal(f.db.operations.length, 0);
  f.deps.savePhoto = save;
  value(f.call("complete", { ...body, photoBase64: photos[0] }));
  const row = f.db.station_task_completions[0];
  assert.equal(row.photo_path!.startsWith("["), false);
  assert.equal(value<Kitchen>(f.call("getKitchen")).tasks[0].photoCount, 1);
  assert.equal(
    value<{ base64: string }>(
      f.call("getPhoto", { category: "station", id: row.id }),
    ).base64,
    photos[0],
  );
});

test("additional-task upload crossing 04:00 rolls back all four photos", async () => {
  const f = setup(),
    photosBase64 = await images();
  value(
    f.call(
      "assignAdditional",
      { typeId: f.db.additional_task_types[0].id, userIds: [f.db.users[1].id] },
      0,
    ),
  );
  f.setTime(new Date("2026-09-07T00:59:59Z"));
  const save = f.deps.savePhoto;
  f.deps.savePhoto = (bytes, name) => {
    const id = save(bytes, name);
    f.setTime(new Date("2026-09-07T01:00:00Z"));
    return id;
  };
  assert.equal(
    f.call("complete", {
      category: "additional",
      id: f.db.additional_tasks[0].id,
      mimeType: "image/webp",
      photosBase64,
    }).success,
    false,
  );
  assert.equal(f.files.size, 0);
  assert.equal(f.db.additional_tasks[0].completed_at, null);
});
