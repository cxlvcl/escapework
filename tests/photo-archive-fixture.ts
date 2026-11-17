import { randomUUID } from "node:crypto";
import sharp from "sharp";
import type { fixture } from "./helpers";
import { dateOffset, workDate, workDayStart } from "../lib/domain";

// Isolated browser-test history; never used with production data or preview accounts.
export async function seedPhotoArchive(f: ReturnType<typeof fixture>) {
  const today = workDate(f.deps.now());
  const yesterday = dateOffset(today, -1);
  const oldestDate = dateOffset(today, -32);
  const photoPaths = await Promise.all(
    ["#136c60", "#4354a5", "#ae6d28", "#8f487d"].map(async (background) => {
      const id = randomUUID();
      f.files.set(
        id,
        await sharp({
          create: { width: 160, height: 120, channels: 3, background },
        })
          .webp()
          .toBuffer(),
      );
      return id;
    }),
  );
  const id = randomUUID();
  f.db.station_tasks.push({
    id,
    station_id: f.db.stations[0].id,
    title: "Архивная проверка станции",
    task_type: "individual",
    sort_order: 99,
    is_active: false,
    created_work_date: oldestDate,
    inactive_work_date: today,
  });
  const record = {
    id: randomUUID(),
    work_date: yesterday,
    completed_at: new Date(workDayStart(today).getTime() - 1).toISOString(),
    completed_by_user_id: null,
    photo_path: JSON.stringify(photoPaths),
  };
  f.db.station_task_completions.push({ ...record, task_id: id });
  f.db.station_task_completions.push({
    ...record,
    id: randomUUID(),
    task_id: id,
    work_date: oldestDate,
    completed_at: workDayStart(oldestDate).toISOString(),
    photo_path: photoPaths[0],
  });
  f.db.refrigerator_task_completions.push({
    ...record,
    id: randomUUID(),
    task_id: f.db.refrigerator_tasks[0].id,
    photo_path: photoPaths[0],
  });
  f.db.additional_tasks.push({
    ...record,
    id: randomUUID(),
    task_type_id: f.db.additional_task_types[0].id,
    title_snapshot: "Архивная дополнительная задача",
    photo_path: JSON.stringify(photoPaths.slice(0, 2)),
  });
}
