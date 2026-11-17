import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allowed,
  workDate,
  snapshotDate,
  progress,
  dateOffset,
  workDayStart,
  type UserRole,
  type Permission,
} from "../lib/domain";
import { hashPassword, verifyPassword } from "../lib/password";
import {
  stationSeed,
  commonTasks,
  fridgeTasks,
  additionalTypes,
} from "../google/src/seed-data";
test("role permission matrix: chef read-only, cook scoped actions, sous-chef management", () => {
  const expected: Record<UserRole, Record<Permission, boolean>> = {
    cook: {
      manage: false,
      monitor: false,
      complete: true,
      shift: true,
      activity: false,
    },
    sous_chef: {
      manage: true,
      monitor: true,
      complete: false,
      shift: false,
      activity: true,
    },
    chef: {
      manage: false,
      monitor: true,
      complete: false,
      shift: false,
      activity: true,
    },
    audit: {
      manage: false,
      monitor: true,
      complete: false,
      shift: false,
      activity: true,
    },
  };
  for (const role of Object.keys(expected) as UserRole[])
    for (const permission of Object.keys(expected[role]) as Permission[])
      assert.equal(allowed(role, permission), expected[role][permission]);
});
test("work day starts at 04:00 Moscow time, including month/year rollover", () => {
  assert.equal(workDate(new Date("2026-09-06T20:59:59Z")), "2026-09-06");
  assert.equal(workDate(new Date("2026-09-06T21:00:00Z")), "2026-09-06");
  assert.equal(workDate(new Date("2026-09-07T00:59:59.999Z")), "2026-09-06");
  assert.equal(workDate(new Date("2026-09-07T01:00:00Z")), "2026-09-07");
  assert.equal(snapshotDate(new Date("2026-09-07T00:59:59Z")), "2026-09-05");
  assert.equal(snapshotDate(new Date("2026-09-07T01:00:00Z")), "2026-09-06");
  assert.equal(workDate(new Date("2027-01-01T00:59:59Z")), "2026-12-31");
  assert.equal(workDate(new Date("2027-01-01T01:00:00Z")), "2027-01-01");
  assert.equal(workDate(new Date("2026-10-01T00:59:59Z")), "2026-09-30");
  assert.equal(
    workDayStart("2026-09-07").toISOString(),
    "2026-09-07T01:00:00.000Z",
  );
  assert.equal(dateOffset("2026-01-01", -1), "2025-12-31");
});
test("progress is weighted by task count and rounds correctly", () => {
  assert.deepEqual(progress(7, 9), {
    completed: 7,
    total: 9,
    remaining: 2,
    percent: 78,
  });
  assert.equal(progress(7, 11).percent, 64);
  assert.equal(progress(0, 0).percent, 0);
  assert.equal(progress(9, 9).remaining, 0);
});
test("fixed catalog exactly matches requested stations and refrigerators", () => {
  assert.equal(stationSeed.length, 9);
  const numbers = stationSeed.flatMap((s) => s.fridges);
  assert.equal(new Set(numbers).size, numbers.length);
  assert.equal(numbers.length, 32);
  assert.equal(commonTasks.length, 2);
  assert.equal(fridgeTasks.length, 3);
  assert.equal(
    stationSeed.reduce((n, s) => n + commonTasks.length + s.extra.length, 0),
    31,
  );
  assert.deepEqual(additionalTypes, [
    "Уборка камеры",
    "Уборка морозной камеры",
    "Уборка сухого склада",
    "Уборка рыбного холодильника",
    "Уборка мясного холодильника",
    "Уборка овощного холодильника",
    "Уборка пароконвектоматов",
    "Уборка фритюра",
    "Уборка камеры шоковой заморозки",
    "Уборка лёдогенератора",
  ]);
  assert.deepEqual(
    stationSeed.find((s) => s.name === "Суши бар Азия")!.fridges,
    [2, 3, 4, 5, 10, 11],
  );
});
test("passwords are salted hashes; wrong passwords rejected", async () => {
  const a = await hashPassword("correct-password");
  const b = await hashPassword("correct-password");
  assert.notEqual(a, b);
  assert.ok(!a.includes("correct-password"));
  assert.equal(await verifyPassword("correct-password", a), true);
  assert.equal(await verifyPassword("incorrect-password", a), false);
  assert.equal(await verifyPassword("x", "bad"), false);
});
