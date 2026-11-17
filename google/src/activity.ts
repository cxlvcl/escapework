import { calendarWeek, getActivityLevel, workDayStart } from "../../lib/domain";
import type { ActivityView } from "../../types/models";
import type { Tables } from "./schema";
export function weeklyActivity(db: Tables, now: Date): ActivityView {
  const { start, end } = calendarWeek(now);
  const from = workDayStart(start).getTime();
  const until = workDayStart(end).getTime();
  const counts = new Map<string, number>();
  for (const records of [
    db.station_task_completions,
    db.refrigerator_task_completions,
    db.additional_tasks,
  ]) {
    const seen = new Set<string>();
    for (const record of records) {
      if (seen.has(record.id)) continue;
      seen.add(record.id);
      if (!record.completed_by_user_id || !record.completed_at) continue;
      const time = Date.parse(record.completed_at);
      if (time >= from && time < until)
        counts.set(
          record.completed_by_user_id,
          (counts.get(record.completed_by_user_id) ?? 0) + 1,
        );
    }
  }
  const summary: ActivityView["summary"] = { low: 0, medium: 0, high: 0 };
  const users = db.users
    .filter((user) => user.role === "cook" && !user.deleted_at)
    .map((user) => {
      const level = getActivityLevel(counts.get(user.id) ?? 0);
      summary[level]++;
      return { id: user.id, name: user.name, role: user.role, level };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  return { start, end, summary, users };
}
