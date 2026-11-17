import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, scryptSync } from "node:crypto";
import { fixture } from "./helpers";
import { execute } from "../google/src/core";
import { verifyPassword } from "../lib/password";
test("PHP account passwords remain compatible, private, idempotent and role protected", async () => {
  const { db, deps } = fixture();
  const id = randomUUID();
  db.users.push({
    id,
    name: "Manager",
    login: "manager",
    role: "sous_chef",
    password_hash: "unused",
    active_station_id: null,
  });
  db.sessions.push({
    user_id: id,
    token_hash: deps.hash("manager"),
    expires_at: "2099-01-01T00:00:00Z",
  });
  const request = {
    action: "createUser",
    token: "manager",
    requestId: randomUUID(),
    data: {
      login: "php-cook",
      name: "PHP Cook",
      role: "cook",
      password: "Secret-test-123",
    },
  };
  const first = execute(db, deps, structuredClone(request));
  assert.equal(first.success, true);
  const user = db.users.find((u) => u.login === "php-cook")!;
  assert.equal(
    await verifyPassword("Secret-test-123", user.password_hash),
    true,
  );
  const [, salt, hex] = user.password_hash.split(":");
  assert.equal(scryptSync("Secret-test-123", salt, 64).toString("hex"), hex);
  assert.equal(execute(db, deps, structuredClone(request)).success, true);
  assert.equal(db.users.filter((u) => u.login === "php-cook").length, 1);
  assert.equal(JSON.stringify(db).includes("Secret-test-123"), false);
  const conflict = execute(db, deps, {
    ...request,
    data: { ...request.data, password: "Different-123" },
  });
  assert.equal(conflict.success, false);
  const denied = execute(db, deps, {
    ...request,
    token: "invalid",
    requestId: randomUUID(),
  });
  assert.equal(denied.success, false);
});
