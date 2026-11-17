import { emptyTables, schema, tableNames, type Tables } from "./schema";
export const legacyColumns: Partial<Record<keyof Tables, string[]>> = {
  users: ["id", "name", "login", "password_hash", "role", "active_station_id"],
  station_task_completions: [
    "id",
    "task_id",
    "work_date",
    "photo_path",
    "completed_at",
  ],
  refrigerator_task_completions: [
    "id",
    "task_id",
    "work_date",
    "photo_path",
    "completed_at",
  ],
  additional_tasks: [
    "id",
    "task_type_id",
    "work_date",
    "photo_path",
    "completed_at",
  ],
  additional_task_types: ["id", "title"],
};
export function migrateValues(values: unknown[][][]): {
  db: Tables;
  changed: (keyof Tables)[];
} {
  const db = emptyTables();
  const changed: (keyof Tables)[] = [];
  for (const [index, table] of tableNames.entries()) {
    const rows = values[index];
    const headers = rows?.[0];
    const current = schema[table] as string[];
    const legacy = legacyColumns[table];
    const same = JSON.stringify(headers) === JSON.stringify(current);
    if (
      !same &&
      (!legacy || JSON.stringify(headers) !== JSON.stringify(legacy))
    )
      throw new Error("Unrecognized schema; no data changed: " + table);
    if (!same) changed.push(table);
    for (const row of rows
      .slice(1)
      .filter((r) => r.some((v) => v !== "" && v !== null))) {
      const record = Object.fromEntries(
        current.map((key) => {
          const pos = (headers as string[]).indexOf(key);
          const value =
            pos < 0 ? (key === "is_active" ? true : null) : row[pos];
          return [key, value === undefined || value === "" ? null : value];
        }),
      );
      (db[table] as unknown[]).push(record);
    }
  }
  if (changed.includes("additional_tasks")) {
    const titles = new Map(
      db.additional_task_types.map((t) => [t.id, t.title]),
    );
    for (const task of db.additional_tasks)
      task.title_snapshot = titles.get(task.task_type_id) ?? null;
  }
  return { db, changed };
}
