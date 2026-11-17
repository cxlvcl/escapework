import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { allowed, type Permission } from "./domain";
import { googleCall } from "@/services/google-client";
import { AppError } from "./errors";
import type { AuthUser, Kitchen } from "@/types/models";
export { AppError };
export type { AuthUser };
export const cookieName = "escape_session";
export async function sessionToken() {
  return (await cookies()).get(cookieName)?.value;
}
export const currentKitchen = cache(async (): Promise<Kitchen | null> => {
  const token = await sessionToken();
  if (!token) return null;
  try {
    return await googleCall<Kitchen>("getKitchen", {}, token);
  } catch (e) {
    if (e instanceof AppError && e.status === 401) return null;
    throw e;
  }
});
export const currentUser = cache(
  async (): Promise<AuthUser | null> => (await currentKitchen())?.user ?? null,
);
export async function requireUser(permission?: Permission) {
  const user = await currentUser();
  if (!user) throw new AppError("Войдите в систему.", 401);
  if (permission && !allowed(user.role, permission))
    throw new AppError("Недостаточно прав.", 403);
  return user;
}
export async function pageUser(permission?: Permission) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !allowed(user.role, permission)) redirect("/");
  return user;
}
export async function createSession(token: string, expiresAt: string) {
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}
export async function destroySession() {
  const token = await sessionToken();
  if (token) await googleCall("logout", {}, token);
  (await cookies()).delete(cookieName);
}
export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new AppError("Недопустимый источник запроса.", 403);
}
export function apiError(error: unknown) {
  if (error instanceof AppError)
    return Response.json(
      {
        success: false,
        data: null,
        error: { code: error.code, message: error.message },
      },
      { status: error.status },
    );
  if (error instanceof Error && error.name === "ZodError")
    return Response.json(
      {
        success: false,
        data: null,
        error: {
          code: "INVALID_INPUT",
          message: "Проверьте заполненные поля.",
        },
      },
      { status: 400 },
    );
  console.error(
    "Request failed",
    error instanceof Error ? error.name : "UnknownError",
  );
  return Response.json(
    {
      success: false,
      data: null,
      error: {
        code: "INTERNAL_ERROR",
        message: "Не удалось выполнить действие. Попробуйте ещё раз.",
      },
    },
    { status: 500 },
  );
}
export function apiSuccess(data: unknown = { ok: true }) {
  return Response.json({ success: true, data, error: null });
}
