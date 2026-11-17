import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import { fixture } from "./helpers";
import { execute, seed, snapshot, counts } from "../google/src/core";
import { hashPassword } from "../lib/password";
import { validateWebp } from "../google/src/security";
import type {
  ApiResult,
  AuthUser,
  Kitchen,
  AdditionalView,
  Statistics,
} from "../types/models";
async function setup() {
  const f = fixture();
  const hash = await hashPassword("test-password");
  f.db.users.push(
    ...(["sous_chef", "cook", "cook", "chef"] as const).map((role, i) => ({
      id: randomUUID(),
      login: "user" + i,
      name: "Test " + i,
      password_hash: hash,
      role,
      active_station_id: null,
    })),
  );
  const tokens = f.db.users.map((u) => {
    const token = randomBytes(32).toString("base64url");
    f.db.sessions.push({
      token_hash: f.deps.hash(token),
      user_id: u.id,
      expires_at: "2026-09-13T15:00:00Z",
    });
    return token;
  });
  const call = (
    index: number,
    action: string,
    data: Record<string, unknown> = {},
    requestId = randomUUID(),
  ) => execute(f.db, f.deps, { action, data, token: tokens[index], requestId });
  return { ...f, tokens, call };
}
function value<T>(r: ApiResult): T {
  assert.ok(r.success, JSON.stringify(r));
  return r.data as T;
}
async function photo() {
  return (
    await sharp({
      create: { width: 1200, height: 800, channels: 3, background: "#aaaaaa" },
    })
      .webp()
      .toBuffer()
  ).toString("base64");
}
test("setup is idempotent; exactly original fixed entities and ten additional types", () => {
  const { db, deps } = fixture();
  const before = JSON.stringify(db);
  seed(db, deps);
  assert.equal(JSON.stringify(db), before);
  assert.equal(db.stations.length, 9);
  assert.equal(db.station_tasks.length, 31);
  assert.equal(db.refrigerators.length, 32);
  assert.equal(db.refrigerator_tasks.length, 96);
  assert.equal(db.additional_task_types.length, 10);
});
test("sous-chef creates all four roles, invalid/unauthorized role rejected; created permissions work", async () => {
  const f = await setup();
  for (const role of ["cook", "sous_chef", "chef", "audit"]) {
    const login = "new-" + role;
    value(
      f.call(0, "createUser", {
        name: login,
        login,
        role,
        passwordHash: await hashPassword("test-password"),
      }),
    );
    const user = f.db.users.find((u) => u.login === login)!;
    assert.equal(user.role, role);
    const result = execute(f.db, f.deps, {
      action: "login",
      data: {
        login,
        password: "test-password",
        sessionToken: randomBytes(32).toString("base64url"),
      },
      requestId: randomUUID(),
    });
    assert.equal(value<{ user: AuthUser }>(result).user.role, role);
  }
  for (const index of [1, 3])
    assert.equal(
      f.call(index, "createUser", {
        name: "x",
        login: "x",
        role: "sous_chef",
        passwordHash: await hashPassword("test-password"),
      }).success,
      false,
    );
  assert.equal(
    f.call(0, "createUser", {
      name: "x",
      login: "x",
      role: "OWNER",
      passwordHash: await hashPassword("test-password"),
    }).success,
    false,
  );
});
test("login password verification, expiry, logout and rate limit are enforced in Google core", async () => {
  const f = await setup();
  const login = (password: string) =>
    execute(f.db, f.deps, {
      action: "login",
      data: {
        login: "user0",
        password,
        sessionToken: randomBytes(32).toString("base64url"),
      },
      requestId: randomUUID(),
    });
  assert.equal(login("wrong").success, false);
  assert.equal(login("test-password").success, true);
  value(f.call(0, "logout"));
  assert.equal(f.call(0, "getCurrentUser").success, false);
  f.setTime(new Date("2026-09-14T15:00:00Z"));
  assert.equal(f.call(1, "getCurrentUser").success, false);
  for (let i = 0; i < 10; i++) login("wrong");
  const blocked = login("test-password");
  assert.ok(!blocked.success);
  assert.equal(blocked.error.status, 429);
});
test("station is shared, completion unique and other-station access denied", async () => {
  const f = await setup(),
    stationId = f.db.stations[0].id;
  value(f.call(1, "shift", { action: "open", stationId }));
  value(f.call(2, "shift", { action: "open", stationId }));
  assert.equal(
    f.call(1, "shift", { action: "open", stationId: f.db.stations[1].id })
      .success,
    false,
  );
  const task = f.db.station_tasks[0];
  const body = {
    category: "station",
    id: task.id,
    mimeType: "image/webp",
    photoBase64: await photo(),
  };
  value(f.call(1, "complete", body));
  assert.equal(f.call(2, "complete", body).success, false);
  assert.equal(f.db.station_task_completions.length, 1);
  const p = counts(f.db, "2026-09-06");
  assert.equal(p.stations.find((s) => s.id === stationId)!.completed, 1);
  const kitchen = value<{ tasks: { completedAt: string | null }[] }>(
    f.call(2, "getKitchen"),
  );
  assert.ok(kitchen.tasks[0].completedAt);
  value(f.call(1, "shift", { action: "close" }));
  assert.equal(
    f.call(1, "getPhoto", {
      category: "station",
      id: f.db.station_task_completions[0].id,
    }).success,
    false,
  );
  assert.equal(
    f.call(1, "complete", {
      ...body,
      id: f.db.station_tasks.find((t) => t.station_id === f.db.stations[1].id)!
        .id,
    }).success,
    false,
  );
});
test("one additional task with two assignees has one shared completion and one total", async () => {
  const f = await setup();
  const typeId = randomUUID();
  f.db.additional_task_types.push({
    id: typeId,
    title: "Test only",
    is_active: true,
  });
  value(
    f.call(0, "assignAdditional", {
      typeId,
      userIds: [f.db.users[1].id, f.db.users[2].id],
    }),
  );
  const task = f.db.additional_tasks[0];
  value(
    f.call(2, "complete", {
      category: "additional",
      id: task.id,
      mimeType: "image/webp",
      photoBase64: await photo(),
    }),
  );
  assert.equal(f.db.additional_tasks.length, 1);
  assert.equal(counts(f.db, "2026-09-06").overall.total, 128);
  const tasks = value<{ tasks: { completedAt: string | null }[] }>(
    f.call(1, "getAdditional"),
  ).tasks;
  assert.ok(tasks[0].completedAt);
});
test("idempotency key prevents duplicate creates and rejects changed request", async () => {
  const f = await setup(),
    id = randomUUID();
  const body = {
    action: "create",
    stationId: f.db.stations[0].id,
    title: "New",
    taskType: "main",
  };
  value(f.call(0, "task", body, id));
  value(f.call(0, "task", body, id));
  assert.equal(f.db.station_tasks.length, 32);
  assert.equal(
    f.call(0, "task", { ...body, title: "Other" }, id).success,
    false,
  );
});
test("required photos and invalid images rejected; failed Drive write never completes", async () => {
  const f = await setup();
  value(f.call(1, "shift", { action: "open", stationId: f.db.stations[0].id }));
  const body = { category: "station", id: f.db.station_tasks[0].id };
  assert.equal(f.call(1, "complete", body).success, false);
  assert.throws(() => validateWebp(Buffer.from("executable")));
  f.deps.savePhoto = () => {
    throw new Error("Drive unavailable");
  };
  assert.throws(() =>
    f.call(1, "complete", {
      ...body,
      mimeType: "image/webp",
      photoBase64: "not-an-image",
    }),
  );
  assert.equal(f.db.station_task_completions.length, 0);
});
test("all task categories remain available past midnight and reset only at 04:00 Moscow", async () => {
  const f = await setup();
  const stationId = f.db.stations[0].id;
  value(f.call(1, "shift", { action: "open", stationId }));
  value(
    f.call(0, "assignAdditional", {
      typeId: f.db.additional_task_types[0].id,
      userIds: [f.db.users[1].id],
    }),
  );
  const body = {
    category: "station",
    id: f.db.station_tasks[0].id,
    mimeType: "image/webp",
    photoBase64: await photo(),
  };
  value(f.call(1, "complete", body));
  const completionId = f.db.station_task_completions[0].id;
  f.setTime(new Date("2026-09-06T21:00:00Z")); // 00:00 MSK
  assert.equal(f.call(1, "complete", body).success, false);
  value(f.call(1, "getPhoto", { category: "station", id: completionId }));
  value(
    f.call(1, "complete", {
      ...body,
      category: "refrigerator",
      id: f.db.refrigerator_tasks[0].id,
    }),
  );
  f.setTime(new Date("2026-09-07T00:59:59.999Z")); // 03:59:59 MSK
  value(
    f.call(1, "complete", {
      ...body,
      category: "additional",
      id: f.db.additional_tasks[0].id,
    }),
  );
  const kitchen = value<Kitchen>(f.call(1, "getKitchen"));
  assert.equal(kitchen.date, "2026-09-06");
  assert.ok(kitchen.tasks[0].completedAt);
  assert.ok(kitchen.fridges.some((t) => t.completedAt));
  assert.ok(
    value<AdditionalView>(f.call(1, "getAdditional")).tasks[0].completedAt,
  );
  assert.equal(
    value<Statistics>(f.call(0, "getStatistics", { period: "today" })).summary
      .completed,
    3,
  );
  snapshot(f.db, f.deps);
  assert.equal(f.db.daily_statistics.length, 0); // active day cannot be frozen early
  for (const records of [
    f.db.station_task_completions,
    f.db.refrigerator_task_completions,
    f.db.additional_tasks,
  ])
    assert.equal(records[0].work_date, "2026-09-06");

  f.setTime(new Date("2026-09-07T01:00:00Z")); // 04:00 MSK
  const next = value<Kitchen>(f.call(1, "getKitchen"));
  assert.equal(next.date, "2026-09-07");
  assert.ok(next.tasks.every((t) => !t.completedAt));
  assert.ok(next.fridges.every((t) => !t.completedAt));
  assert.equal(next.user.activeStationId, stationId);
  assert.equal(
    value<AdditionalView>(f.call(1, "getAdditional")).tasks.length,
    0,
  );
  assert.equal(
    f.call(1, "getPhoto", { category: "station", id: completionId }).success,
    false,
  );
  const yesterday = value<Statistics>(
    f.call(0, "getStatistics", { period: "yesterday" }),
  );
  assert.equal(yesterday.pending, false);
  assert.equal(yesterday.days.length, 1);
  assert.equal(yesterday.days[0].date, "2026-09-06");
  assert.equal(yesterday.days[0].finalized, true);
  assert.equal(yesterday.summary.completed, 3);
  assert.equal(yesterday.summary.total, 128);
  const station = value<Statistics>(
    f.call(0, "getStatistics", { period: "yesterday", stationId }),
  );
  assert.equal(station.summary.completed, 2); // additional tasks belong only to the overall result
  assert.equal(station.summary.total, 14);
  value(f.call(1, "complete", body));
  assert.equal(f.db.station_task_completions[1].work_date, "2026-09-07");
  assert.equal(
    value<Statistics>(f.call(0, "getStatistics", { period: "today" })).summary
      .completed,
    1,
  );
  const frozen = JSON.stringify([
    f.db.daily_statistics,
    f.db.daily_station_statistics,
  ]);
  value(f.call(0, "task", { action: "delete", id: body.id }));
  value(
    f.call(0, "task", {
      action: "create",
      stationId,
      title: "New day task",
      taskType: "individual",
    }),
  );
  snapshot(f.db, f.deps);
  assert.equal(
    JSON.stringify([f.db.daily_statistics, f.db.daily_station_statistics]),
    frozen,
  );
});

test("statistics recover missed closed days and preserve stored totals without inventing pre-launch history", async () => {
  const f = await setup();
  f.setTime(new Date("2026-09-09T01:00:00Z"));
  f.db.daily_statistics.push({
    work_date: "2026-09-07",
    completed_tasks: 5,
    total_tasks: 100,
  });
  const before = JSON.stringify(f.db.daily_statistics);
  assert.equal(
    f.call(1, "getStatistics", { period: "yesterday" }).success,
    false,
  );
  assert.equal(
    f.call(0, "getStatistics", { period: "invalid" }).success,
    false,
  );
  assert.equal(JSON.stringify(f.db.daily_statistics), before);
  const yesterday = value<Statistics>(
    f.call(0, "getStatistics", { period: "yesterday" }),
  );
  assert.equal(yesterday.days[0].date, "2026-09-08");
  assert.equal(yesterday.summary.total, 127);
  assert.equal(yesterday.pending, false);
  const week = value<Statistics>(
    f.call(0, "getStatistics", { period: "week" }),
  );
  assert.deepEqual(
    week.days.map((d) => d.date),
    ["2026-09-09", "2026-09-08", "2026-09-07", "2026-09-06"],
  );
  assert.equal(week.days.filter((d) => !d.finalized).length, 1);
  assert.equal(week.summary.completed, 5);
  assert.equal(week.summary.total, 481);
  assert.equal(
    value<Statistics>(f.call(0, "getStatistics", { period: "month" })).days
      .length,
    4,
  );
  const frozen = JSON.stringify([
    f.db.daily_statistics,
    f.db.daily_station_statistics,
  ]);
  snapshot(f.db, f.deps);
  value(f.call(0, "getStatistics", { period: "yesterday" }));
  assert.equal(
    JSON.stringify([f.db.daily_statistics, f.db.daily_station_statistics]),
    frozen,
  );
});

test("snapshot retries before 04:00 close only past work days and retain exactly the history window", async () => {
  const f = await setup();
  f.setTime(new Date("2026-09-07T00:59:59Z"));
  f.db.daily_statistics.push(
    { work_date: "2026-08-04", completed_tasks: 0, total_tasks: 1 },
    { work_date: "2026-08-05", completed_tasks: 0, total_tasks: 1 },
  );
  snapshot(f.db, f.deps);
  assert.ok(!f.db.daily_statistics.some((s) => s.work_date === "2026-08-04"));
  assert.ok(f.db.daily_statistics.some((s) => s.work_date === "2026-08-05"));
  assert.ok(!f.db.daily_statistics.some((s) => s.work_date === "2026-09-06"));
  f.setTime(new Date("2026-09-07T01:00:00Z"));
  snapshot(f.db, f.deps);
  assert.ok(!f.db.daily_statistics.some((s) => s.work_date === "2026-08-05"));
  assert.ok(f.db.daily_statistics.some((s) => s.work_date === "2026-09-06"));
});

test("uploads use the work day at save time when crossing 04:00", async () => {
  const f = await setup();
  value(f.call(1, "shift", { action: "open", stationId: f.db.stations[0].id }));
  const body = {
    category: "station",
    id: f.db.station_tasks[0].id,
    mimeType: "image/webp",
    photoBase64: await photo(),
  };
  const save = f.deps.savePhoto;
  f.deps.savePhoto = (...args) => {
    const id = save(...args);
    f.setTime(new Date("2026-09-07T01:00:00Z"));
    return id;
  };
  f.setTime(new Date("2026-09-07T00:59:59Z"));
  value(f.call(1, "complete", body));
  assert.equal(f.db.station_task_completions[0].work_date, "2026-09-07");
  f.setTime(new Date("2026-09-07T00:59:59Z"));
  value(
    f.call(0, "assignAdditional", {
      typeId: f.db.additional_task_types[0].id,
      userIds: [f.db.users[1].id],
    }),
  );
  assert.equal(
    f.call(1, "complete", {
      ...body,
      category: "additional",
      id: f.db.additional_tasks[0].id,
    }).success,
    false,
  );
  assert.equal(f.db.additional_tasks[0].completed_at, null);
  assert.equal(f.files.size, 1);
});

test("migration read-only statistics never create snapshots", async () => {
  const f = await setup();
  f.setTime(new Date("2026-09-07T01:00:00Z"));
  f.deps.readOnly = true;
  const before = JSON.stringify(f.db);
  const result = value<Statistics>(
    f.call(0, "getStatistics", { period: "yesterday" }),
  );
  assert.equal(result.pending, true);
  assert.equal(JSON.stringify(f.db), before);
});
