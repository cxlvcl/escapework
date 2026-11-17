import { photoPaths } from "../../lib/task-photos";
import type { Task } from "../../types/models";
import type { Tables } from "./schema";

// Read completions directly: a task may have been disabled after its photo was saved.
export function completedPhotos(db: Tables, date: string): Task[] {
  const result: Task[] = [];
  const stationTasks = new Map(db.station_tasks.map((t) => [t.id, t]));
  const fridgeTasks = new Map(db.refrigerator_tasks.map((t) => [t.id, t]));
  const fridges = new Map(db.refrigerators.map((r) => [r.id, r]));
  for (const c of db.station_task_completions) {
    const t = stationTasks.get(c.task_id);
    if (!t || c.work_date !== date || !c.completed_at || !c.photo_path)
      continue;
    result.push({
      id: t.id,
      title: t.title,
      category: "station",
      stationId: t.station_id,
      taskType: t.task_type,
      sortOrder: t.sort_order,
      completedAt: c.completed_at,
      photoId: c.id,
      photoCount: photoPaths(c.photo_path).length,
    });
  }
  for (const c of db.refrigerator_task_completions) {
    const t = fridgeTasks.get(c.task_id);
    const r = t && fridges.get(t.refrigerator_id);
    if (!t || !r || c.work_date !== date || !c.completed_at || !c.photo_path)
      continue;
    result.push({
      id: t.id,
      title: t.title,
      category: "refrigerator",
      stationId: r.station_id,
      refrigeratorId: r.id,
      refrigeratorNumber: r.number,
      sortOrder: t.sort_order,
      completedAt: c.completed_at,
      photoId: c.id,
      photoCount: photoPaths(c.photo_path).length,
    });
  }
  for (const t of db.additional_tasks) {
    if (t.work_date !== date || !t.completed_at || !t.photo_path) continue;
    result.push({
      id: t.id,
      title:
        t.title_snapshot ??
        db.additional_task_types.find((type) => type.id === t.task_type_id)!
          .title,
      category: "additional",
      completedAt: t.completed_at,
      photoId: t.id,
      photoCount: photoPaths(t.photo_path).length,
      assignees: db.additional_task_assignees
        .filter((a) => a.additional_task_id === t.id)
        .map((a) => db.users.find((u) => u.id === a.user_id)!.name),
    });
  }
  return result.sort(
    (a, b) =>
      (a.refrigeratorNumber ?? 0) - (b.refrigeratorNumber ?? 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0) ||
      a.id.localeCompare(b.id),
  );
}
