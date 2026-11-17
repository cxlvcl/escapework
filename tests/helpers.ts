import { createHash, createHmac, randomUUID } from "node:crypto";
import { emptyTables } from "../google/src/schema";
import { seed, type Dependencies } from "../google/src/core";
import {
  verifyPasswordBytes,
  validateWebp,
  hashPasswordBytes,
} from "../google/src/security";
export function fixture(now = new Date("2026-09-06T15:00:00Z")) {
  let clock = now;
  const fingerprintSecret = randomUUID();
  const files = new Map<string, Buffer>();
  const deps: Dependencies = {
    now: () => clock,
    uuid: randomUUID,
    hash: (v) => createHash("sha256").update(v).digest("hex"),
    verify: (p, h) =>
      verifyPasswordBytes(Buffer.from(p), (s) => Buffer.from(s), h),
    hashPassword: (p) =>
      hashPasswordBytes(Buffer.from(p), randomUUID().replace(/-/g, ""), (s) =>
        Buffer.from(s),
      ),
    credentialFingerprint: (password) =>
      createHmac("sha256", fingerprintSecret).update(password).digest("hex"),
    savePhoto: (data) => {
      const b = Buffer.from(data, "base64");
      validateWebp(b);
      const id = randomUUID();
      files.set(id, b);
      return id;
    },
    getPhoto: (id) => {
      const b = files.get(id);
      if (!b) throw new Error("File missing");
      return { base64: b.toString("base64"), mimeType: "image/webp" };
    },
    trashPhoto: (id) => {
      files.delete(id);
    },
    bootstrapEnabled: true,
  };
  const db = emptyTables();
  seed(db, deps);
  return {
    db,
    deps,
    files,
    setTime: (date: Date) => {
      clock = date;
    },
  };
}
