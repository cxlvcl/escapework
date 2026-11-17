import type { UserRole } from "@/lib/domain";
export interface AuthUser {
  id: string;
  name: string;
  login: string;
  role: UserRole;
  activeStationId: string | null;
}
export interface Station {
  id: string;
  name: string;
}
export interface Task {
  id: string;
  title: string;
  category: "station" | "refrigerator" | "additional";
  completedAt: string | null;
  photoId: string | null;
  photoCount?: number;
  stationId?: string;
  taskType?: "main" | "individual";
  sortOrder?: number;
  refrigeratorId?: string;
  refrigeratorNumber?: number;
  assignees?: string[];
}
export interface Progress {
  completed: number;
  total: number;
  remaining: number;
  percent: number;
}
export interface Kitchen {
  user: AuthUser;
  stations: Station[];
  tasks: Task[];
  fridges: Task[];
  managedRefrigerators?: { id: string; number: number; stationId: string }[];
  stats: { stations: (Progress & { id: string })[]; overall: Progress } | null;
  date: string;
}
export interface AdditionalView {
  tasks: Task[];
  types: { id: string; title: string; is_active: boolean }[];
  cooks: { id: string; name: string }[];
}
export interface PhotosView {
  date: string;
  today: string;
  oldestDate: string;
  stations: Station[];
  tasks: Task[];
}
export interface UsersView {
  users: AuthUser[];
  roles: { id: UserRole; name: string }[];
}
export interface Statistics {
  days: (Progress & { date: string; finalized: boolean })[];
  summary: Progress;
  pending: boolean;
}
export type ApiResult<T = unknown> =
  | { success: true; data: T; error: null }
  | {
      success: false;
      data: null;
      error: { code: string; message: string; status: number };
    };
export interface BackendRequest {
  action: string;
  data: Record<string, unknown>;
  token?: string;
  requestId: string;
}

export interface ActivityView {
  start: string;
  end: string;
  summary: Record<import("@/lib/domain").ActivityLevel, number>;
  users: {
    id: string;
    name: string;
    role: UserRole;
    level: import("@/lib/domain").ActivityLevel;
  }[];
}
