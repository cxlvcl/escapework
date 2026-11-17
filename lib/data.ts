import "server-only";
import { cache } from "react";
import { sessionToken, currentKitchen } from "./auth";
import { googleCall } from "@/services/google-client";
import type {
  AdditionalView,
  UsersView,
  Statistics,
  PhotosView,
} from "@/types/models";
export type { Task } from "@/types/models";
const kitchen = cache(async () => {
  const value = await currentKitchen();
  if (!value) throw new Error("Unauthorized");
  return value;
});
export async function stationList() {
  return (await kitchen()).stations;
}
export async function stationTasks(stationId: string) {
  return (await kitchen()).tasks.filter((t) => t.stationId === stationId);
}
export async function fridgeTasks(stationId: string) {
  return (await kitchen()).fridges.filter((t) => t.stationId === stationId);
}
export async function currentStats() {
  const result = (await kitchen()).stats;
  if (!result) throw new Error("Statistics not available");
  return result;
}
export const additionalView = cache(async () =>
  googleCall<AdditionalView>("getAdditional", {}, await sessionToken()),
);
export async function additionalTasks() {
  return (await additionalView()).tasks;
}
export const usersView = cache(async () =>
  googleCall<UsersView>("getUsers", {}, await sessionToken()),
);
export const photosView = cache(async (date?: string) =>
  googleCall<PhotosView>(
    "getPhotos",
    date === undefined ? {} : { date },
    await sessionToken(),
  ),
);
export async function statistics(
  period: "today" | "yesterday" | "week" | "month",
  stationId?: string,
) {
  return googleCall<Statistics>(
    "getStatistics",
    { period, stationId },
    await sessionToken(),
  );
}

export const activityView = cache(async () =>
  googleCall<import("@/types/models").ActivityView>(
    "getActivity",
    {},
    await sessionToken(),
  ),
);

export async function managedRefrigerators(stationId: string) {
  return ((await kitchen()).managedRefrigerators ?? []).filter(r => r.stationId === stationId);
}
