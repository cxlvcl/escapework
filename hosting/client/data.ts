import { currentKitchen, read } from "./auth";
import type {
  AdditionalView,
  UsersView,
  Statistics,
  ActivityView,
  PhotosView,
} from "../../types/models";
export type { Task } from "../../types/models";
async function kitchen() {
  const data = await currentKitchen();
  if (!data) throw new Error("Войдите в систему.");
  return data;
}
export async function stationList() {
  return (await kitchen()).stations;
}
export async function stationTasks(id: string) {
  return (await kitchen()).tasks.filter((t) => t.stationId === id);
}
export async function fridgeTasks(id: string) {
  return (await kitchen()).fridges.filter((t) => t.stationId === id);
}
export async function currentStats() {
  const stats = (await kitchen()).stats;
  if (!stats) throw new Error("Недостаточно прав.");
  return stats;
}
export const additionalView = () => read<AdditionalView>("additional");
export async function additionalTasks() {
  return (await additionalView()).tasks;
}
export const usersView = () => read<UsersView>("users");
export const activityView = () => read<ActivityView>("activity");
export const photosView = (date?: string) =>
  read<PhotosView>("photos", date === undefined ? {} : { date });
export const statistics = (
  period: "today" | "yesterday" | "week" | "month",
  stationId?: string,
) =>
  read<Statistics>("statistics", {
    period,
    ...(stationId ? { stationId } : {}),
  });

export async function managedRefrigerators(stationId: string) {
  return ((await kitchen()).managedRefrigerators ?? []).filter(r => r.stationId === stationId);
}
