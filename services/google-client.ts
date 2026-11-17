// Node-only transport: shared by Next server and local bootstrap, never imported by UI.
import { createHmac, randomUUID } from "node:crypto";
import type { ApiResult } from "../types/models";
import { AppError } from "../lib/errors";
export async function googleCall<T>(
  action: string,
  data: Record<string, unknown> = {},
  token?: string,
  requestId: string = randomUUID(),
): Promise<T> {
  const url = process.env.GOOGLE_API_URL,
    secret = process.env.GOOGLE_API_SECRET;
  if (!url || !secret || secret.length < 32)
    throw new AppError(
      "Google backend ещё не настроен.",
      503,
      "NOT_CONFIGURED",
    );
  const parsed = new URL(url);
  const local =
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  if (
    !local &&
    (parsed.protocol !== "https:" ||
      parsed.hostname !== "script.google.com" ||
      !parsed.pathname.endsWith("/exec"))
  )
    throw new AppError("Некорректный адрес Google backend.", 503);
  const payload = JSON.stringify({
    action,
    data,
    token,
    requestId,
    timestamp: Date.now(),
  });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload, signature }),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(55000),
    });
  } catch {
    throw new AppError(
      "Сервис Google недоступен или отвечает слишком долго. Попробуйте ещё раз.",
      503,
      "TIMEOUT",
    );
  }
  if (!response.ok)
    throw new AppError(
      "Не удалось связаться с Google backend.",
      503,
      "BACKEND_UNAVAILABLE",
    );
  let result: ApiResult<T>;
  try {
    result = await response.json();
  } catch {
    throw new AppError(
      "Google вернул неверный ответ. Проверьте Web App deployment.",
      503,
      "INVALID_RESPONSE",
    );
  }
  if (!result || typeof result.success !== "boolean")
    throw new AppError("Некорректный ответ Google backend.", 503);
  if (!result.success)
    throw new AppError(
      result.error.message,
      result.error.status,
      result.error.code,
    );
  return result.data;
}
