import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fixture } from "./helpers";
import { execute } from "../google/src/core";
import { dateOffset } from "../lib/domain";
import type { ApiResult, PhotosView } from "../types/models";

function setup() {
  const f = fixture(new Date("2026-09-15T08:00:00Z"));
  for (const role of ["sous_chef", "chef", "audit", "cook"] as const) {
    const id = randomUUID();
    f.db.users.push({
      id,
      role,
      name: role,
      login: role,
      password_hash: "unused",
      active_station_id: null,
    });
    f.db.sessions.push({
      user_id: id,
      token_hash: f.deps.hash(role),
      expires_at: "2099-01-01T00:00:00Z",
    });
  }
  const call = (
    data: Record<string, unknown> = {},
    token: string | undefined = "sous_chef",
  ) =>
    execute(f.db, f.deps, {
      action: "getPhotos",
      data,
      token,
      requestId: randomUUID(),
    });
  return { ...f, call };
}
function value(result: ApiResult): PhotosView {
  assert.ok(result.success, JSON.stringify(result));
  return result.data as PhotosView;
}
test("photo archive authorizes every monitoring role and validates 32 closed days plus today", () => {
  const f = setup();
  for (const role of ["sous_chef", "chef", "audit"]) {
    const result = value(f.call({}, role));
    assert.equal(result.date, "2026-09-15");
    assert.equal(result.today, result.date);
    assert.equal(result.oldestDate, "2026-08-14");
    assert.deepEqual(result.tasks, []);
    value(f.call({ date: result.oldestDate }, role));
  }
  assert.equal(f.call({}, "cook").success, false);
  assert.equal(f.call({}, "").success, false);
  for (const date of [
    null,
    [],
    20260914,
    "",
    "2026-08-32",
    "2026-09-1",
    "2026-08-13",
    "2026-09-16",
    "2026-09-14T00:00:00Z",
  ])
    assert.equal(f.call({ date }).success, false, JSON.stringify(date));
});

test("historical photos include disabled tasks, all categories and every image without changing stored data", () => {
  const f = setup();
  const paths = ["first", "second", "third", "fourth"];
  for (const path of paths) f.files.set(path, Buffer.from(path));
  const saved = {
    id: randomUUID(),
    work_date: "2026-09-14",
    completed_at: "2026-09-15T00:59:59.999Z",
    completed_by_user_id: f.db.users[3].id,
    photo_path: JSON.stringify(paths),
  };
  f.db.station_tasks[0].is_active = false;
  f.db.station_tasks[0].inactive_work_date = "2026-09-15";
  f.db.station_task_completions.push({
    ...saved,
    task_id: f.db.station_tasks[0].id,
  });
  f.db.refrigerator_task_completions.push({
    ...saved,
    id: randomUUID(),
    task_id: f.db.refrigerator_tasks[0].id,
    photo_path: paths[0],
  });
  f.db.additional_task_types[0].is_active = false;
  f.db.additional_tasks.push({
    ...saved,
    id: randomUUID(),
    task_type_id: f.db.additional_task_types[0].id,
    title_snapshot: "Historical additional title",
    photo_path: JSON.stringify(paths.slice(0, 2)),
  });
  const todayId = randomUUID();
  f.db.station_task_completions.push({
    ...saved,
    id: todayId,
    task_id: f.db.station_tasks[0].id,
    work_date: "2026-09-15",
    completed_at: "2026-09-15T01:00:00.000Z",
  });
  f.deps.readOnly = true;
  const before = structuredClone(f.db);
  const yesterday = value(f.call({ date: "2026-09-14" }));
  assert.equal(yesterday.tasks.length, 3);
  for (const [category, count] of [
    ["station", 4],
    ["refrigerator", 1],
    ["additional", 2],
  ] as const) {
    const task = yesterday.tasks.find((t) => t.category === category)!;
    assert.equal(task.photoCount, count);
    assert.ok(task.photoId);
    assert.equal("photo_path" in task, false);
    for (let index = 0; index < count; index++) {
      const photo = execute(f.db, f.deps, {
        action: "getPhoto",
        data: { category, id: task.photoId, index },
        token: "sous_chef",
        requestId: randomUUID(),
      });
      assert.ok(photo.success);
      assert.equal(
        (photo.data as { base64: string }).base64,
        Buffer.from(paths[index]).toString("base64"),
      );
    }
  }
  assert.equal(
    yesterday.tasks.find((t) => t.category === "additional")!.title,
    "Historical additional title",
  );
  assert.deepEqual(
    value(f.call()).tasks.map((t) => t.photoId),
    [todayId],
  );
  assert.deepEqual(value(f.call({ date: "2026-09-13" })).tasks, []);
  assert.deepEqual(f.db, before);
});

test("archive boundaries and default gallery move at 04:00 Moscow, not midnight", () => {
  const f = setup();
  f.db.station_task_completions.push({
    id: randomUUID(),
    task_id: f.db.station_tasks[0].id,
    work_date: "2026-09-14",
    completed_at: "2026-09-15T00:59:59Z",
    completed_by_user_id: null,
    photo_path: "saved",
  });
  for (const at of ["2026-09-14T21:00:00Z", "2026-09-15T00:59:59.999Z"]) {
    f.setTime(new Date(at));
    assert.equal(value(f.call()).date, "2026-09-14");
    assert.equal(value(f.call()).tasks.length, 1);
    assert.equal(f.call({ date: "2026-09-15" }).success, false);
  }
  const previousOldest = value(f.call()).oldestDate;
  f.setTime(new Date("2026-09-15T01:00:00Z"));
  assert.equal(value(f.call()).date, "2026-09-15");
  assert.equal(value(f.call()).tasks.length, 0);
  assert.equal(value(f.call({ date: "2026-09-14" })).tasks.length, 1);
  assert.equal(value(f.call()).oldestDate, dateOffset(previousOldest, 1));
  assert.equal(f.call({ date: previousOldest }).success, false);
});
