import { scrypt } from "@noble/hashes/scrypt.js";
export function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export function verifyPasswordBytes(
  password: Uint8Array,
  saltBytes: (s: string) => Uint8Array,
  encoded: string,
) {
  const [kind, salt, hex] = encoded.split(":");
  if (kind !== "scrypt" || !salt || !hex) return false;
  const actual = scrypt(password, saltBytes(salt), {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: 64,
  });
  return constantEqual(
    Array.from(actual, (b) => b.toString(16).padStart(2, "0")).join(""),
    hex,
  );
}
export function validateWebp(bytes: Uint8Array) {
  if (bytes.length < 30 || bytes.length > 3 * 1024 * 1024)
    throw new Error("Invalid image size");
  const str = (i: number, n: number) =>
    String.fromCharCode(...bytes.slice(i, i + n));
  const u32 = (i: number) =>
    (bytes[i] |
      (bytes[i + 1] << 8) |
      (bytes[i + 2] << 16) |
      (bytes[i + 3] << 24)) >>>
    0;
  if (
    str(0, 4) !== "RIFF" ||
    str(8, 4) !== "WEBP" ||
    u32(4) + 8 !== bytes.length
  )
    throw new Error("Invalid WebP");
  let width = 0,
    height = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const tag = str(offset, 4),
      length = u32(offset + 4),
      start = offset + 8;
    if (start + length > bytes.length) throw new Error("Truncated image");
    if (tag === "ANIM" || tag === "ANMF")
      throw new Error("Animated images not allowed");
    if (
      tag === "VP8 " &&
      length >= 10 &&
      str(start + 3, 3) === "\x9d\x01\x2a"
    ) {
      width = (bytes[start + 6] | (bytes[start + 7] << 8)) & 0x3fff;
      height = (bytes[start + 8] | (bytes[start + 9] << 8)) & 0x3fff;
    }
    if (tag === "VP8L" && length >= 5 && bytes[start] === 0x2f) {
      const bits = u32(start + 1);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
    offset = start + length + (length % 2);
  }
  if (width < 1 || height < 1 || width > 1600 || height > 1600)
    throw new Error("Invalid dimensions");
  return { width, height };
}

export function hashPasswordBytes(
  password: Uint8Array,
  salt: string,
  saltBytes: (s: string) => Uint8Array,
) {
  const hash = scrypt(password, saltBytes(salt), {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: 64,
  });
  return `scrypt:${salt}:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
