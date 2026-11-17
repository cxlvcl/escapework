export type UserRole = "cook" | "sous_chef" | "chef" | "audit";
export const roleLabels: Record<UserRole, string> = {
  cook: "Повар",
  sous_chef: "Су-шеф",
  chef: "Шеф-повар",
  audit: "Аудит",
};
export type Permission =
  "manage" | "monitor" | "complete" | "shift" | "activity";
export function allowed(role: UserRole, permission: Permission) {
  return permission === "manage"
    ? role === "sous_chef"
    : permission === "monitor" || permission === "activity"
      ? role !== "cook"
      : role === "cook";
}
export const WORK_DAY_START_HOUR = 4;
export const PHOTO_ARCHIVE_DAYS = 32;
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const time = Date.parse(`${value}T12:00:00Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}
export function workDate(now = new Date()) {
  // 00:00–03:59 Moscow time still belongs to the preceding work day.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() - WORK_DAY_START_HOUR * 60 * 60 * 1000));
}
export function workDayStart(date: string) {
  return new Date(
    `${date}T${String(WORK_DAY_START_HOUR).padStart(2, "0")}:00:00+03:00`,
  );
}
export function dateOffset(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function snapshotDate(now = new Date()) {
  return dateOffset(workDate(now), -1);
}
export function progress(completed: number, total: number) {
  return {
    completed,
    total,
    remaining: Math.max(0, total - completed),
    percent: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}
export function timeLabel(date: string | Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}
export function dateLabel(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(`${date}T12:00:00Z`));
}

export type ActivityLevel = "low" | "medium" | "high";
export function getActivityLevel(count: number): ActivityLevel {
  if (count <= 10) return "low";
  if (count <= 17) return "medium";
  return "high";
}
export const activityLabels: Record<ActivityLevel, string> = {
  low: "Низкая активность",
  medium: "Средняя активность",
  high: "Высокая активность",
};
export function calendarWeek(now = new Date()) {
  const date = workDate(now);
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  const start = dateOffset(date, -((day + 6) % 7));
  return { start, end: dateOffset(start, 7) };
}
