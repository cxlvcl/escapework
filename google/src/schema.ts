import type { UserRole } from "../../lib/domain";
export interface User {
  id: string;
  name: string;
  login: string;
  password_hash: string;
  deleted_at?: string | null;
  role: UserRole;
  active_station_id: string | null;
}
export interface StationTask {
  id: string;
  station_id: string;
  title: string;
  task_type: "main" | "individual";
  sort_order: number;
  is_active: boolean;
  created_work_date: string;
  inactive_work_date: string | null;
}
export interface Completion {
  id: string;
  task_id: string;
  work_date: string;
  photo_path: string;
  completed_at: string;
  completed_by_user_id: string | null;
}
export interface Additional {
  id: string;
  task_type_id: string;
  work_date: string;
  photo_path: string | null;
  completed_at: string | null;
  completed_by_user_id: string | null;
  title_snapshot: string | null;
}
export interface Tables {
  stations: { id: string; name: string }[];
  users: User[];
  station_tasks: StationTask[];
  station_task_completions: Completion[];
  refrigerators: { id: string; number: number; station_id: string }[];
  refrigerator_tasks: {
    id: string;
    refrigerator_id: string;
    title: string;
    sort_order: number;
  }[];
  refrigerator_task_completions: Completion[];
  additional_task_types: { id: string; title: string; is_active: boolean }[];
  additional_tasks: Additional[];
  additional_task_assignees: { additional_task_id: string; user_id: string }[];
  daily_statistics: {
    work_date: string;
    completed_tasks: number;
    total_tasks: number;
  }[];
  daily_station_statistics: {
    work_date: string;
    station_id: string;
    completed_tasks: number;
    total_tasks: number;
  }[];
  sessions: { token_hash: string; user_id: string; expires_at: string }[];
  login_attempts: { key: string; attempts: number; reset_at: string }[];
  operations: {
    id: string;
    fingerprint: string;
    response: string;
    expires_at: string;
  }[];
}
export const schema: { [K in keyof Tables]: (keyof Tables[K][number])[] } = {
  stations: ["id", "name"],
  users: [
    "id",
    "name",
    "login",
    "password_hash",
    "role",
    "active_station_id",
    "deleted_at",
  ],
  station_tasks: [
    "id",
    "station_id",
    "title",
    "task_type",
    "sort_order",
    "is_active",
    "created_work_date",
    "inactive_work_date",
  ],
  station_task_completions: [
    "id",
    "task_id",
    "work_date",
    "photo_path",
    "completed_at",
    "completed_by_user_id",
  ],
  refrigerators: ["id", "number", "station_id"],
  refrigerator_tasks: ["id", "refrigerator_id", "title", "sort_order"],
  refrigerator_task_completions: [
    "id",
    "task_id",
    "work_date",
    "photo_path",
    "completed_at",
    "completed_by_user_id",
  ],
  additional_task_types: ["id", "title", "is_active"],
  additional_tasks: [
    "id",
    "task_type_id",
    "work_date",
    "photo_path",
    "completed_at",
    "completed_by_user_id",
    "title_snapshot",
  ],
  additional_task_assignees: ["additional_task_id", "user_id"],
  daily_statistics: ["work_date", "completed_tasks", "total_tasks"],
  daily_station_statistics: [
    "work_date",
    "station_id",
    "completed_tasks",
    "total_tasks",
  ],
  sessions: ["token_hash", "user_id", "expires_at"],
  login_attempts: ["key", "attempts", "reset_at"],
  operations: ["id", "fingerprint", "response", "expires_at"],
};
export const tableNames = Object.keys(schema) as (keyof Tables)[];
export function emptyTables(): Tables {
  return Object.fromEntries(
    tableNames.map((k) => [k, []]),
  ) as unknown as Tables;
}
