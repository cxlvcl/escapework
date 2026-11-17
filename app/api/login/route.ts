import { randomBytes } from "node:crypto";
import { z } from "zod";
import { apiError, apiSuccess, checkOrigin, createSession } from "@/lib/auth";
import { googleCall } from "@/services/google-client";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const input = z
      .object({
        login: z.string().trim().min(1).max(80),
        password: z.string().min(1).max(128),
      })
      .parse(await request.json());
    const sessionToken = randomBytes(32).toString("base64url");
    const result = await googleCall<{ expiresAt: string }>("login", {
      ...input,
      sessionToken,
    });
    await createSession(sessionToken, result.expiresAt);
    return apiSuccess();
  } catch (e) {
    return apiError(e);
  }
}
