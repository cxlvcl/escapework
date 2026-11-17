import { z } from "zod";
import { createHmac } from "node:crypto";
import {
  apiError,
  apiSuccess,
  AppError,
  checkOrigin,
  requireUser,
} from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { forward } from "@/lib/forward";
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await requireUser("manage");
    const body = await request.json();
    if (body?.action === "delete") {
      const { id } = z.object({ id: z.uuid() }).parse(body);
      return apiSuccess(await forward(request, "deleteUser", { id }));
    }
    const input = z
      .object({
        id: z.uuid().optional(),
        name: z.string().trim().min(1).max(100),
        login: z.string().trim().min(1).max(80),
        role: z.enum(["cook", "sous_chef", "chef", "audit"]).optional(),
        password: z.string().max(128).optional(),
      })
      .parse(body);
    if (
      (!input.id || input.password) &&
      (!input.password || input.password.length < 8)
    )
      throw new AppError("Пароль должен содержать не менее 8 символов.");
    if (!input.id && !input.role)
      throw new AppError("Выберите роль пользователя.");
    const { password, ...data } = input;
    const result = await forward(
      request,
      input.id ? "updateUser" : "createUser",
      {
        ...data,
        ...(password
          ? {
              passwordHash: await hashPassword(password),
              credentialFingerprint: createHmac(
                "sha256",
                process.env.GOOGLE_API_SECRET!,
              )
                .update(password)
                .digest("hex"),
            }
          : {}),
      },
    );
    return apiSuccess(result);
  } catch (e) {
    return apiError(e);
  }
}
