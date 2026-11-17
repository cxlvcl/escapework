import { allowed, type Permission } from "../../lib/domain";
import type { AuthUser, Kitchen } from "../../types/models";
import { redirect } from "./navigation";
export type { AuthUser };
export class ReadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
const cache = new Map<string, Promise<unknown>>();
export function resetReads() {
  cache.clear();
}
export function read<T>(
  view: string,
  query: Record<string, string> = {},
): Promise<T> {
  const url = "/api/read?" + new URLSearchParams({ view, ...query });
  if (!cache.has(url))
    cache.set(
      url,
      (async () => {
        const res = await fetch(url, {
          cache: "no-store",
          signal: AbortSignal.timeout(65000),
        });
        const data = await res.json();
        if (!res.ok || !data.success)
          throw new ReadError(
            data.error?.message || "Не удалось загрузить данные.",
            res.status,
          );
        return data.data;
      })(),
    );
  return cache.get(url) as Promise<T>;
}
export async function currentKitchen(): Promise<Kitchen | null> {
  try {
    return await read<Kitchen>("kitchen");
  } catch (e) {
    if (e instanceof ReadError && e.status === 401) return null;
    throw e;
  }
}
export async function currentUser() {
  if (
    ![
      "/login",
      "/profile",
      "/users",
      "/activity",
      "/additional",
      "/photos",
    ].includes(location.pathname.replace(/\/$/, ""))
  )
    return (await currentKitchen())?.user ?? null;
  try {
    return await read<AuthUser>("user");
  } catch (e) {
    if (e instanceof ReadError && e.status === 401) return null;
    throw e;
  }
}
export async function pageUser(permission?: Permission) {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (permission && !allowed(user.role, permission)) redirect("/");
  return user;
}
