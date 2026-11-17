import { timingSafeEqual } from "node:crypto";
import { apiError, apiSuccess, AppError } from "@/lib/auth";
import { googleCall } from "@/services/google-client";
export const maxDuration = 120;
export async function POST(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret || secret.length < 32)
      throw new AppError("Cron не настроен.", 503);
    const expected = Buffer.from("Bearer " + secret),
      given = Buffer.from(request.headers.get("authorization") ?? "");
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      throw new AppError("Недостаточно прав.", 403);
    return apiSuccess(await googleCall("snapshot"));
  } catch (e) {
    return apiError(e);
  }
}
