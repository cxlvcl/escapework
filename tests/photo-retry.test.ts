import { test } from "node:test";
import assert from "node:assert/strict";
import { post } from "../services/api";

test("photo retries keep a key for the same set and use a new key after selection changes", async (t) => {
  const keys: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      keys.push(new Headers(init.headers).get("Idempotency-Key")!);
      if (keys.length <= 2) throw new Error("Connection interrupted");
      return Response.json({ success: true, data: { ok: true } });
    },
  );
  const form = (photos: string[]) => {
    const data = new FormData();
    data.set("category", "station");
    data.set("id", "test-task");
    for (const photo of photos)
      data.append(
        "photos[]",
        new Blob([photo], { type: "image/webp" }),
        "photo.webp",
      );
    return data;
  };
  await assert.rejects(post("/api/complete", form(["first", "second"])));
  await assert.rejects(post("/api/complete", form(["first", "second"])));
  await post("/api/complete", form(["first", "replacement"]));
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[1], keys[2]);
});
