import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./helpers";
import { execute, seed } from "../google/src/core";
import { weeklyActivity } from "../google/src/activity";
import { migrateValues, legacyColumns } from "../google/src/migration";
import { schema, tableNames, type Completion } from "../google/src/schema";
import {
  calendarWeek,
  getActivityLevel,
  allowed,
  type UserRole,
} from "../lib/domain";
function setup() {
  const f = fixture(new Date("2026-09-09T10:00:00Z"));
  const roles: UserRole[] = [
    "sous_chef",
    "chef",
    "audit",
    "cook",
    "cook",
    "cook",
  ];
  for (const [i, role] of roles.entries()) {
    const id = randomUUID();
    f.db.users.push({
      id,
      name: "User " + i,
      login: "u" + i,
      password_hash: "unused",
      role,
      active_station_id: role === "cook" ? f.db.stations[0].id : null,
    });
    f.db.sessions.push({
      token_hash: f.deps.hash("token" + i),
      user_id: id,
      expires_at: "2026-10-01T00:00:00Z",
    });
  }
  const call = (
    i: number,
    action: string,
    data: Record<string, unknown> = {},
    requestId: string = randomUUID(),
  ) => execute(f.db, f.deps, { action, data, token: "token" + i, requestId });
  return { ...f, call };
}
test("activity boundaries and calendar week respect 04:00 Moscow and year rollover", () => {
  for (const [count, level] of [
    [0, "low"],
    [10, "low"],
    [11, "medium"],
    [17, "medium"],
    [18, "high"],
    [25, "high"],
    [100, "high"],
  ] as const)
    assert.equal(getActivityLevel(count), level);
  assert.deepEqual(calendarWeek(new Date("2026-09-06T20:59:59.999Z")), {
    start: "2026-08-31",
    end: "2026-09-07",
  });
  assert.deepEqual(calendarWeek(new Date("2026-09-06T21:00:00Z")), {
    start: "2026-08-31",
    end: "2026-09-07",
  });
  assert.deepEqual(calendarWeek(new Date("2026-09-07T00:59:59.999Z")), {
    start: "2026-08-31",
    end: "2026-09-07",
  });
  assert.deepEqual(calendarWeek(new Date("2026-09-07T01:00:00Z")), {
    start: "2026-09-07",
    end: "2026-09-14",
  });
  assert.deepEqual(calendarWeek(new Date("2027-01-01T00:00:00Z")), {
    start: "2026-12-28",
    end: "2027-01-04",
  });
});
test("activity is server-authorized; chef and audit have identical permissions", () => {
  const f = setup();
  for (const i of [0, 1, 2])
    assert.equal(f.call(i, "getActivity").success, true);
  for (const i of [3, 4, 5])
    assert.equal(f.call(i, "getActivity").success, false);
  for (const permission of [
    "manage",
    "monitor",
    "complete",
    "shift",
    "activity",
  ] as const)
    assert.equal(allowed("chef", permission), allowed("audit", permission));
  const result = execute(f.db, f.deps, {
    action: "getActivity",
    data: {},
    requestId: randomUUID(),
  });
  assert.equal(result.success, false);
  for (const i of [1, 2, 3])
    assert.equal(
      f.call(i, "additionalType", { title: "Denied", isActive: true }).success,
      false,
    );
});
test("weekly counts include each category once, exclude unknown authors and adjacent weeks", () => {
  const f = setup(),
    userId = f.db.users[3].id;
  const record = (
    completed_at: string,
    author: string | null = userId,
  ): Completion => ({
    id: randomUUID(),
    task_id: randomUUID(),
    work_date: "2026-09-09",
    photo_path: "photo",
    completed_at,
    completed_by_user_id: author,
  });
  const station = record("2026-09-07T01:00:00Z");
  f.db.station_task_completions.push(
    station,
    station,
    record("2026-09-07T00:59:59.999Z"),
    record("2026-09-14T01:00:00Z"),
    record("2026-09-09T10:00:00Z", null),
  );
  for (let i = 0; i < 8; i++)
    f.db.station_task_completions.push(record("2026-09-09T10:00:00Z"));
  f.db.refrigerator_task_completions.push(record("2026-09-14T00:59:59.999Z"));
  assert.equal(
    weeklyActivity(f.db, f.deps.now()).users.find((u) => u.id === userId)!
      .level,
    "low",
  );
  f.db.additional_tasks.push({
    id: randomUUID(),
    task_type_id: f.db.additional_task_types[0].id,
    work_date: "2026-09-09",
    title_snapshot: "task",
    photo_path: "photo",
    completed_at: "2026-09-09T10:00:00Z",
    completed_by_user_id: userId,
  });
  const result = weeklyActivity(f.db, f.deps.now());
  assert.equal(result.users.find((u) => u.id === userId)!.level, "medium");
  assert.equal(result.summary.medium, 1);
  assert.equal(result.summary.low, 2);
  assert.equal(result.users.length, 3);
  assert.ok(result.users.every((user) => user.role === "cook"));
  assert.equal("count" in result.users[0], false);
});
test("real shared completions credit only session author, with retry and spoof protection", async () => {
  const f = setup();
  const photoBase64 = (
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#888" },
    })
      .webp()
      .toBuffer()
  ).toString("base64");
  const station = f.db.station_tasks[0];
  const command = {
    category: "station",
    id: station.id,
    mimeType: "image/webp",
    photoBase64,
    completed_by_user_id: f.db.users[4].id,
  };
  const requestId = randomUUID();
  assert.equal(f.call(3, "complete", command, requestId).success, true);
  assert.equal(f.call(3, "complete", command, requestId).success, true);
  assert.equal(f.call(4, "complete", command).success, false);
  assert.equal(f.db.station_task_completions.length, 1);
  assert.equal(
    f.db.station_task_completions[0].completed_by_user_id,
    f.db.users[3].id,
  );
  assert.equal(
    f.call(3, "complete", {
      ...command,
      category: "refrigerator",
      id: f.db.refrigerator_tasks[0].id,
    }).success,
    true,
  );
  assert.equal(
    f.db.refrigerator_task_completions[0].completed_by_user_id,
    f.db.users[3].id,
  );
  assert.equal(
    f.call(0, "assignAdditional", {
      typeId: f.db.additional_task_types[0].id,
      userIds: f.db.users.slice(3).map((u) => u.id),
    }).success,
    true,
  );
  assert.equal(
    f.call(4, "complete", {
      ...command,
      category: "additional",
      id: f.db.additional_tasks[0].id,
    }).success,
    true,
  );
  assert.equal(f.db.additional_tasks[0].completed_by_user_id, f.db.users[4].id);
  for (const i of [3, 4, 5]) {
    const result = f.call(i, "getAdditional");
    assert.ok(result.success);
    assert.ok(
      (result.data as { tasks: { completedAt: string }[] }).tasks[0]
        .completedAt,
    );
  }
  // Bring each author to a boundary: only credited completions cross it.
  for (let i = 0; i < 9; i++)
    f.db.station_task_completions.push({
      ...f.db.station_task_completions[0],
      id: randomUUID(),
    });
  let view = weeklyActivity(f.db, f.deps.now());
  assert.equal(
    view.users.find((u) => u.id === f.db.users[3].id)!.level,
    "medium",
  );
  assert.equal(view.users.find((u) => u.id === f.db.users[4].id)!.level, "low");
  for (let i = 0; i < 10; i++)
    f.db.additional_tasks.push({
      ...f.db.additional_tasks[0],
      id: randomUUID(),
    });
  view = weeklyActivity(f.db, f.deps.now());
  assert.equal(
    view.users.find((u) => u.id === f.db.users[4].id)!.level,
    "medium",
  );
  assert.equal(view.users.find((u) => u.id === f.db.users[5].id)!.level, "low");
});
test("catalog edits preserve assigned titles, hidden types cannot be assigned, seed is stable", () => {
  const f = setup(),
    type = f.db.additional_task_types[0],
    title = type.title;
  assert.equal(
    f.call(0, "assignAdditional", {
      typeId: type.id,
      userIds: [f.db.users[3].id],
    }).success,
    true,
  );
  assert.equal(
    f.call(0, "additionalType", {
      id: type.id,
      title: "Новое название",
      isActive: false,
    }).success,
    true,
  );
  assert.equal(f.db.additional_tasks[0].title_snapshot, title);
  assert.equal(
    f.call(0, "assignAdditional", {
      typeId: type.id,
      userIds: [f.db.users[3].id],
    }).success,
    false,
  );
  const before = JSON.stringify(f.db.additional_task_types);
  seed(f.db, f.deps);
  assert.equal(JSON.stringify(f.db.additional_task_types), before);
  const id = randomUUID(),
    data = { title: "Новый тип", isActive: true };
  assert.equal(f.call(0, "additionalType", data, id).success, true);
  assert.equal(f.call(0, "additionalType", data, id).success, true);
  assert.equal(
    f.db.additional_task_types.filter((t) => t.title === data.title).length,
    1,
  );
});
test("role editing can select audit, revokes sessions and protects the last manager", () => {
  const f = setup(),
    target = f.db.users[3];
  assert.equal(
    f.call(0, "updateUser", {
      id: target.id,
      name: target.name,
      login: target.login,
      role: "audit",
    }).success,
    true,
  );
  assert.equal(target.role, "audit");
  assert.equal(target.active_station_id, null);
  assert.equal(f.call(3, "getKitchen").success, false);
  const manager = f.db.users[0];
  assert.equal(
    f.call(0, "updateUser", {
      id: manager.id,
      name: manager.name,
      login: manager.login,
      role: "audit",
    }).success,
    false,
  );
  assert.equal(f.db.users[0].role, "sous_chef");
});
test("Google migration retains old rows and null authors, snapshots titles, is repeatable and rejects unknown headers", () => {
  const raw = tableNames.map(
    (t) => [...[legacyColumns[t] ?? [...schema[t]]]] as unknown[][],
  );
  raw[tableNames.indexOf("additional_task_types")].push(["type", "Old title"]);
  raw[tableNames.indexOf("additional_tasks")].push([
    "task",
    "type",
    "2026-09-01",
    "drive",
    "2026-09-01T12:00:00Z",
  ]);
  raw[tableNames.indexOf("station_task_completions")].push([
    "completion",
    "stationtask",
    "2026-09-01",
    "drive2",
    "2026-09-01T12:00:00Z",
  ]);
  const original = JSON.stringify(raw);
  const { db, changed } = migrateValues(raw);
  assert.equal(changed.length, 5);
  assert.equal(JSON.stringify(raw), original);
  assert.equal(db.additional_tasks[0].title_snapshot, "Old title");
  assert.equal(db.additional_tasks[0].completed_by_user_id, null);
  assert.equal(db.station_task_completions[0].photo_path, "drive2");
  assert.equal(db.additional_task_types[0].is_active, true);
  const current = tableNames.map((t) => [
    [...schema[t]],
    ...db[t].map((row) =>
      (schema[t] as string[]).map(
        (k) => (row as unknown as Record<string, unknown>)[k],
      ),
    ),
  ]);
  assert.deepEqual(migrateValues(current).db, db);
  assert.equal(migrateValues(current).changed.length, 0);
  raw[0][0] = ["unknown"];
  assert.throws(() => migrateValues(raw), /Unrecognized schema/);
});

test("account deletion is manager-only, revokes access, preserves history and protects last sous-chef", () => {
  const f = setup();
  const target = f.db.users[3];
  for (const i of [1, 2, 3])
    assert.equal(f.call(i, "deleteUser", { id: target.id }).success, false);
  assert.equal(
    f.call(0, "assignAdditional", {
      typeId: f.db.additional_task_types[0].id,
      userIds: [target.id],
    }).success,
    true,
  );
  const before = JSON.stringify(f.db.additional_tasks);
  const key = randomUUID();
  assert.equal(f.call(0, "deleteUser", { id: target.id }, key).success, true);
  assert.equal(f.call(0, "deleteUser", { id: target.id }, key).success, true);
  assert.equal(f.call(3, "getKitchen").success, false);
  const users = f.call(0, "getUsers");
  assert.ok(users.success);
  assert.ok(
    !(users.data as { users: { id: string }[] }).users.some(
      (u) => u.id === target.id,
    ),
  );
  assert.equal(JSON.stringify(f.db.additional_tasks), before);
  assert.ok(f.db.users.find((u) => u.id === target.id)!.deleted_at);
  assert.equal(f.call(0, "getAdditional").success, true);
  assert.equal(
    f.call(0, "assignAdditional", {
      typeId: f.db.additional_task_types[0].id,
      userIds: [target.id],
    }).success,
    false,
  );
  assert.equal(
    f.call(0, "deleteUser", { id: f.db.users[0].id }).success,
    false,
  );
});
