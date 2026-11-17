"use client";
// One browser transport for existing same-origin routes. Google IDs/URL/secrets stay on server.
const pendingKeys = new Map<string, string>();
async function formSignature(body: FormData) {
  const fields: [string, string][] = [];
  for (const [name, value] of body.entries()) {
    if (typeof value === "string") fields.push([name, value]);
    else {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await value.arrayBuffer(),
      );
      fields.push([
        name,
        value.type +
          ":" +
          Array.from(new Uint8Array(digest), (byte) =>
            byte.toString(16).padStart(2, "0"),
          ).join(""),
      ]);
    }
  }
  return JSON.stringify(fields);
}
export async function post(url: string, body: unknown) {
  const signature =
    body instanceof FormData
      ? url + ":" + (await formSignature(body))
      : url + ":" + JSON.stringify(body);
  const requestId = pendingKeys.get(signature) ?? crypto.randomUUID();
  pendingKeys.set(signature, requestId);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
        "Idempotency-Key": requestId,
      },
      body: body instanceof FormData ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(65000),
    });
  } catch {
    throw new Error(
      "Не удалось связаться с сервером. Проверьте интернет и повторите попытку.",
    );
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error("Не удалось получить ответ сервера. Попробуйте ещё раз.");
  }
  if (!res.ok || !data.success) {
    if (res.status < 500) pendingKeys.delete(signature);
    throw new Error(data.error?.message ?? "Не удалось выполнить действие.");
  }
  pendingKeys.delete(signature);
  return data.data;
}
