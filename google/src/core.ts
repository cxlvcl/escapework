import { weeklyActivity } from "./activity";
import { completedPhotos } from "./photos";
import {
  encodePhotoPaths,
  photoPaths,
  MAX_TASK_PHOTOS,
} from "../../lib/task-photos";
import {
  allowed,
  workDate,
  dateOffset,
  progress,
  roleLabels,
  PHOTO_ARCHIVE_DAYS,
  isCalendarDate,
  type Permission,
  type UserRole,
} from "../../lib/domain";
import type {
  ApiResult,
  AuthUser,
  BackendRequest,
  Task,
} from "../../types/models";
import {
  stationSeed,
  commonTasks,
  fridgeTasks,
  additionalTypes,
} from "./seed-data";
import { type Tables, type User } from "./schema";
export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public persist = false,
  ) {
    super(message);
  }
}
function fail(message: string, status = 400, code = "INVALID_INPUT"): never {
  throw new BackendError(code, message, status);
}
export interface Dependencies {
  now(): Date;
  uuid(): string;
  hash(value: string): string;
  verify(password: string, hash: string): boolean;
  hashPassword?(password: string): string;
  credentialFingerprint?(password: string): string;
  savePhoto(base64: string, name: string): string;
  getPhoto(id: string): { base64: string; mimeType: string };
  trashPhoto(id: string): void;
  bootstrapEnabled: boolean;
  readOnly?: boolean;
}
const roleIds = Object.keys(roleLabels) as UserRole[];
export const roleOptions = roleIds.map((id) => ({ id, name: roleLabels[id] }));
function text(v: unknown, max = 300) {
  if (typeof v !== "string" || !v.trim() || v.trim().length > max)
    fail("Проверьте заполненные поля.");
  return v.trim();
}
function uuid(v: unknown) {
  const s = text(v, 80);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  )
    fail("Некорректный идентификатор.");
  return s;
}
function pwdHash(v: unknown) {
  if (typeof v !== "string" || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(v))
    fail("Некорректный хеш пароля.");
  return v;
}
function viewUser(u: User): AuthUser {
  return {
    id: u.id,
    name: u.name,
    login: u.login,
    role: u.role,
    activeStationId: u.active_station_id,
  };
}
function permission(user: User, p: Permission) {
  if (!allowed(user.role, p)) fail("Недостаточно прав.", 403, "FORBIDDEN");
}
function current(db: Tables, deps: Dependencies, token?: string): User {
  if (!token) fail("Войдите в систему.", 401, "UNAUTHORIZED");
  const session = db.sessions.find(
    (s) =>
      s.token_hash === deps.hash(token) &&
      s.expires_at > deps.now().toISOString(),
  );
  const user = db.users.find((u) => u.id === session?.user_id && !u.deleted_at);
  if (!user) fail("Сессия истекла. Войдите снова.", 401, "UNAUTHORIZED");
  return user;
}
export function seed(db: Tables, deps: Dependencies) {
  for (const station of stationSeed) {
    let row = db.stations.find((s) => s.name === station.name);
    if (!row) {
      row = { id: deps.uuid(), name: station.name };
      db.stations.push(row);
      for (const [i, title] of [...commonTasks, ...station.extra].entries())
        db.station_tasks.push({
          id: deps.uuid(),
          station_id: row.id,
          title,
          task_type: "main",
          sort_order: i,
          is_active: true,
          created_work_date: workDate(deps.now()),
          inactive_work_date: null,
        });
    }
    for (const number of station.fridges) {
      let fridge = db.refrigerators.find((r) => r.number === number);
      if (!fridge) {
        fridge = { id: deps.uuid(), number, station_id: row.id };
        db.refrigerators.push(fridge);
      }
      for (const [i, title] of fridgeTasks.entries())
        if (
          !db.refrigerator_tasks.some(
            (t) => t.refrigerator_id === fridge.id && t.sort_order === i,
          )
        )
          db.refrigerator_tasks.push({
            id: deps.uuid(),
            refrigerator_id: fridge.id,
            title,
            sort_order: i,
          });
    }
  }
  for (const [index, title] of additionalTypes.entries()) {
    const id = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
    if (!db.additional_task_types.some((t) => t.id === id))
      db.additional_task_types.push({ id, title, is_active: true });
  }
}
function stationOrder(db: Tables) {
  return [...db.stations].sort(
    (a, b) =>
      stationSeed.findIndex((s) => s.name === a.name) -
      stationSeed.findIndex((s) => s.name === b.name),
  );
}
export function counts(db: Tables, date: string) {
  const stations = db.stations.map((s) => {
    const tasks = db.station_tasks.filter(
      (t) =>
        t.station_id === s.id &&
        t.created_work_date <= date &&
        (!t.inactive_work_date || t.inactive_work_date > date),
    );
    const fridges = db.refrigerator_tasks.filter((t) =>
      db.refrigerators.some(
        (r) => r.id === t.refrigerator_id && r.station_id === s.id,
      ),
    );
    const completed =
      tasks.filter((t) =>
        db.station_task_completions.some(
          (c) => c.task_id === t.id && c.work_date === date,
        ),
      ).length +
      fridges.filter((t) =>
        db.refrigerator_task_completions.some(
          (c) => c.task_id === t.id && c.work_date === date,
        ),
      ).length;
    return { id: s.id, ...progress(completed, tasks.length + fridges.length) };
  });
  const extra = db.additional_tasks.filter((t) => t.work_date === date);
  return {
    stations,
    overall: progress(
      stations.reduce((n, s) => n + s.completed, 0) +
        extra.filter((t) => t.completed_at).length,
      stations.reduce((n, s) => n + s.total, 0) + extra.length,
    ),
  };
}
function finalizeClosedStatistics(db: Tables, today: string) {
  const oldest = dateOffset(today, -32);
  // Recover missed jobs only since the first known task/completion date.
  // The active work day is never finalized, including after midnight.
  let first = today;
  for (const task of db.station_tasks)
    if (task.created_work_date < first) first = task.created_work_date;
  for (const records of [
    db.station_task_completions,
    db.refrigerator_task_completions,
    db.additional_tasks,
  ])
    for (const record of records)
      if (record.work_date < first) first = record.work_date;
  const saved = new Set(db.daily_statistics.map((s) => s.work_date));
  for (
    let date = first < oldest ? oldest : first;
    date < today;
    date = dateOffset(date, 1)
  ) {
    if (saved.has(date)) continue;
    const p = counts(db, date);
    for (const s of p.stations)
      db.daily_station_statistics.push({
        work_date: date,
        station_id: s.id,
        completed_tasks: s.completed,
        total_tasks: s.total,
      });
    db.daily_statistics.push({
      work_date: date,
      completed_tasks: p.overall.completed,
      total_tasks: p.overall.total,
    });
  }
  db.daily_statistics = db.daily_statistics.filter(
    (s) => s.work_date >= oldest,
  );
  db.daily_station_statistics = db.daily_station_statistics.filter(
    (s) => s.work_date >= oldest,
  );
}
export function snapshot(db: Tables, deps: Dependencies) {
  const now = deps.now(),
    today = workDate(now);
  finalizeClosedStatistics(db, today);
  db.sessions = db.sessions.filter((s) => s.expires_at > now.toISOString());
  db.login_attempts = db.login_attempts.filter(
    (s) => s.reset_at > now.toISOString(),
  );
  db.operations = db.operations.filter((s) => s.expires_at > now.toISOString());
  return { ok: true, workDate: dateOffset(today, -1) };
}
function taskViews(db: Tables, user: User, date: string) {
  const tasks: Task[] = db.station_tasks
    .filter(
      (t) =>
        t.is_active &&
        (user.role !== "cook" || t.station_id === user.active_station_id),
    )
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map((t) => {
      const c = db.station_task_completions.find(
        (c) => c.task_id === t.id && c.work_date === date,
      );
      return {
        id: t.id,
        title: t.title,
        stationId: t.station_id,
        taskType: t.task_type,
        sortOrder: t.sort_order,
        category: "station",
        completedAt: c?.completed_at ?? null,
        photoId: c?.id ?? null,
        photoCount: photoPaths(c?.photo_path).length,
      };
    });
  const fridges: Task[] = db.refrigerator_tasks
    .filter((t) =>
      db.refrigerators.some(
        (r) =>
          r.id === t.refrigerator_id &&
          (user.role !== "cook" || r.station_id === user.active_station_id),
      ),
    )
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((t) => {
      const r = db.refrigerators.find((r) => r.id === t.refrigerator_id)!;
      const c = db.refrigerator_task_completions.find(
        (c) => c.task_id === t.id && c.work_date === date,
      );
      return {
        id: t.id,
        title: t.title,
        category: "refrigerator" as const,
        stationId: r.station_id,
        refrigeratorId: r.id,
        refrigeratorNumber: r.number,
        completedAt: c?.completed_at ?? null,
        photoId: c?.id ?? null,
        photoCount: photoPaths(c?.photo_path).length,
      };
    })
    .sort((a, b) => a.refrigeratorNumber! - b.refrigeratorNumber!);
  return { tasks, fridges };
}
function additionalView(db: Tables, user: User, date: string): Task[] {
  return db.additional_tasks
    .filter(
      (t) =>
        t.work_date === date &&
        (user.role !== "cook" ||
          db.additional_task_assignees.some(
            (a) => a.additional_task_id === t.id && a.user_id === user.id,
          )),
    )
    .map((t) => ({
      id: t.id,
      title:
        t.title_snapshot ??
        db.additional_task_types.find((x) => x.id === t.task_type_id)!.title,
      category: "additional",
      completedAt: t.completed_at,
      photoId: t.completed_at ? t.id : null,
      photoCount: photoPaths(t.photo_path).length,
      ...(user.role === "cook"
        ? {}
        : {
            assignees: db.additional_task_assignees
              .filter((a) => a.additional_task_id === t.id)
              .map((a) => db.users.find((u) => u.id === a.user_id)!.name),
          }),
    }));
}
function authorizeTask(
  db: Tables,
  user: User,
  category: string,
  id: string,
  date: string,
) {
  permission(user, "complete");
  if (category === "station") {
    const t = db.station_tasks.find((t) => t.id === id && t.is_active);
    if (
      !t ||
      !user.active_station_id ||
      t.station_id !== user.active_station_id
    )
      fail("Задача недоступна на вашей станции.", 403, "FORBIDDEN");
    if (
      db.station_task_completions.some(
        (c) => c.task_id === id && c.work_date === date,
      )
    )
      fail("Эта задача уже выполнена.", 409, "ALREADY_COMPLETED");
  } else if (category === "refrigerator") {
    const t = db.refrigerator_tasks.find((t) => t.id === id);
    const fridge = db.refrigerators.find((r) => r.id === t?.refrigerator_id);
    if (
      !fridge ||
      !user.active_station_id ||
      fridge.station_id !== user.active_station_id
    )
      fail("Холодильник недоступен на вашей станции.", 403, "FORBIDDEN");
    if (
      db.refrigerator_task_completions.some(
        (c) => c.task_id === id && c.work_date === date,
      )
    )
      fail("Эта задача уже выполнена.", 409, "ALREADY_COMPLETED");
  } else if (category === "additional") {
    const t = db.additional_tasks.find((t) => t.id === id);
    if (
      !t ||
      !db.additional_task_assignees.some(
        (a) => a.additional_task_id === id && a.user_id === user.id,
      )
    )
      fail("Задача вам не назначена.", 403, "FORBIDDEN");
    if (t.work_date !== date || t.completed_at)
      fail(
        "Эта задача уже выполнена или относится к прошедшему дню.",
        409,
        "ALREADY_COMPLETED",
      );
  } else fail("Неизвестная категория задачи.");
}
export const writeActions = [
  "login",
  "logout",
  "bootstrap",
  "shift",
  "task",
  "createUser",
  "updateUser",
  "deleteUser",
  "assignAdditional",
  "additionalType",
  "complete",
  "snapshot",
];
export function dispatch(
  db: Tables,
  deps: Dependencies,
  req: BackendRequest,
): unknown {
  const d = req.data,
    now = deps.now(),
    date = workDate(now);
  if (req.action === "bootstrap") {
    if (!deps.bootstrapEnabled) fail("Первоначальная настройка закрыта.", 403);
    if (db.users.some((u) => u.role === "sous_chef" && !u.deleted_at))
      return { ok: true, created: false };
    const login = text(d.login, 80);
    if (db.users.some((u) => u.login === login && !u.deleted_at))
      fail("Этот логин уже занят.", 409);
    db.users.push({
      id: deps.uuid(),
      name: text(d.name, 100),
      login,
      password_hash: pwdHash(d.passwordHash),
      role: "sous_chef",
      active_station_id: null,
    });
    return { ok: true, created: true };
  }
  if (req.action === "snapshot") return snapshot(db, deps);
  if (req.action === "login") {
    const login = text(d.login, 80);
    if (
      typeof d.password !== "string" ||
      d.password.length > 128 ||
      !d.password
    )
      fail("Проверьте заполненные поля.");
    const key = deps.hash("login:" + login);
    let a = db.login_attempts.find((a) => a.key === key);
    if (!a) {
      a = {
        key,
        attempts: 0,
        reset_at: new Date(now.getTime() + 900000).toISOString(),
      };
      db.login_attempts.push(a);
    }
    if (a.reset_at <= now.toISOString()) {
      a.attempts = 0;
      a.reset_at = new Date(now.getTime() + 900000).toISOString();
    }
    a.attempts++;
    if (a.attempts > 10)
      throw new BackendError(
        "RATE_LIMIT",
        "Слишком много попыток. Повторите через 15 минут.",
        429,
        true,
      );
    const user = db.users.find((u) => u.login === login && !u.deleted_at);
    const valid = deps.verify(
      d.password,
      user?.password_hash ?? "scrypt:" + "0".repeat(32) + ":" + "0".repeat(128),
    );
    if (!user || !valid)
      throw new BackendError(
        "BAD_LOGIN",
        "Неверный логин или пароль.",
        401,
        true,
      );
    const token = text(d.sessionToken, 128);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail("Некорректная сессия.");
    const expiresAt = new Date(now.getTime() + 7 * 86400000).toISOString();
    db.sessions = db.sessions.filter((s) => s.expires_at > now.toISOString());
    db.sessions.push({
      token_hash: deps.hash(token),
      user_id: user.id,
      expires_at: expiresAt,
    });
    db.login_attempts = db.login_attempts.filter((a) => a.key !== key);
    return { user: viewUser(user), expiresAt };
  }
  if (req.action === "logout") {
    db.sessions = db.sessions.filter(
      (s) => s.token_hash !== deps.hash(req.token ?? ""),
    );
    return { ok: true };
  }
  const user = current(db, deps, req.token);
  if (req.action === "getCurrentUser") return viewUser(user);
  if (req.action === "getKitchen")
    return {
      user: viewUser(user),
      date,
      stations: stationOrder(db),
      ...taskViews(db, user, date),
      stats: user.role === "cook" ? null : counts(db, date),
    };
  if (req.action === "getAdditional")
    return {
      tasks: additionalView(db, user, date),
      types: user.role === "sous_chef" ? db.additional_task_types : [],
      cooks:
        user.role === "sous_chef"
          ? db.users
              .filter((u) => u.role === "cook" && !u.deleted_at)
              .map((u) => ({ id: u.id, name: u.name }))
          : [],
    };
  if (req.action === "getActivity") {
    permission(user, "activity");
    return weeklyActivity(db, now);
  }
  if (req.action === "getPhotos") {
    permission(user, "monitor");
    const selected = d.date === undefined ? date : d.date;
    const oldestDate = dateOffset(date, -PHOTO_ARCHIVE_DAYS);
    if (!isCalendarDate(selected) || selected < oldestDate || selected > date)
      fail("Выберите дату за последние 32 рабочих дня или текущий день.");
    return {
      date: selected,
      today: date,
      oldestDate,
      stations: stationOrder(db),
      tasks: completedPhotos(db, selected),
    };
  }
  if (req.action === "getUsers") {
    permission(user, "manage");
    return {
      users: db.users.filter((u) => !u.deleted_at).map(viewUser),
      roles: roleOptions,
    };
  }
  if (req.action === "getRoles") {
    permission(user, "manage");
    return roleOptions;
  }
  if (req.action === "getStatistics") {
    permission(user, "monitor");
    const period = d.period;
    if (!["today", "yesterday", "week", "month"].includes(String(period)))
      fail("Некорректный период.");
    const stationId = d.stationId ? uuid(d.stationId) : undefined;
    if (stationId && !db.stations.some((s) => s.id === stationId))
      fail("Станция не найдена.", 404);
    if (!deps.readOnly) finalizeClosedStatistics(db, date);
    const start = dateOffset(
      date,
      period === "yesterday"
        ? -1
        : period === "week"
          ? -6
          : period === "month"
            ? -29
            : 0,
    );
    const end = period === "yesterday" ? start : date;
    const rows = stationId
      ? db.daily_station_statistics.filter((s) => s.station_id === stationId)
      : db.daily_statistics;
    const days = rows
      .filter(
        (s) => s.work_date >= start && s.work_date <= end && s.work_date < date,
      )
      .map((s) => ({
        date: s.work_date,
        ...progress(s.completed_tasks, s.total_tasks),
        finalized: true,
      }));
    if (end === date) {
      const live = counts(db, date);
      days.push({
        date,
        ...(stationId
          ? live.stations.find((s) => s.id === stationId)!
          : live.overall),
        finalized: false,
      });
    }
    days.sort((a, b) => b.date.localeCompare(a.date));
    return {
      days,
      summary: progress(
        days.reduce((n, s) => n + s.completed, 0),
        days.reduce((n, s) => n + s.total, 0),
      ),
      pending:
        period !== "today" &&
        !days.some((s) => s.date === dateOffset(date, -1)),
    };
  }
  if (req.action === "getPhoto") {
    const id = uuid(d.id),
      category = d.category;
    const c =
      category === "station"
        ? db.station_task_completions.find((c) => c.id === id)
        : category === "refrigerator"
          ? db.refrigerator_task_completions.find((c) => c.id === id)
          : category === "additional"
            ? db.additional_tasks.find((t) => t.id === id)
            : undefined;
    if (!c?.photo_path) fail("Фото не найдено.", 404);
    if (user.role === "cook") {
      if (c.work_date !== date) fail("Недостаточно прав.", 403);
      if (category === "additional") {
        if (
          !db.additional_task_assignees.some(
            (a) => a.additional_task_id === id && a.user_id === user.id,
          )
        )
          fail("Недостаточно прав.", 403);
      } else {
        const taskId = "task_id" in c ? c.task_id : "";
        const sid =
          category === "station"
            ? db.station_tasks.find((t) => t.id === taskId)?.station_id
            : db.refrigerators.find(
                (r) =>
                  r.id ===
                  db.refrigerator_tasks.find((t) => t.id === taskId)
                    ?.refrigerator_id,
              )?.station_id;
        if (!user.active_station_id || sid !== user.active_station_id)
          fail("Недостаточно прав.", 403);
      }
    }
    const index = d.index ?? 0;
    const paths = photoPaths(c.photo_path);
    if (
      !Number.isInteger(index) ||
      typeof index !== "number" ||
      index < 0 ||
      index >= paths.length
    )
      fail("Фото не найдено.", 404, "NOT_FOUND");
    return deps.getPhoto(paths[index]);
  }
  if (req.action === "shift") {
    permission(user, "shift");
    if (d.action === "close") {
      user.active_station_id = null;
    } else if (d.action === "open") {
      if (user.active_station_id) fail("Сначала закройте текущую смену.", 409);
      const id = uuid(d.stationId);
      if (!db.stations.some((s) => s.id === id))
        fail("Станция не найдена.", 404);
      user.active_station_id = id;
    } else fail("Некорректное действие.");
    return { ok: true };
  }
  if (req.action === "deleteUser") {
    permission(user, "manage");
    const target = db.users.find((u) => u.id === uuid(d.id));
    if (!target) fail("Аккаунт не найден.", 404);
    if (target.deleted_at) return { ok: true };
    if (
      target.role === "sous_chef" &&
      !db.users.some(
        (u) => u.id !== target.id && u.role === "sous_chef" && !u.deleted_at,
      )
    )
      fail("Нельзя удалить последнего су-шефа.", 409);
    target.deleted_at = now.toISOString();
    target.active_station_id = null;
    db.sessions = db.sessions.filter((s) => s.user_id !== target.id);
    return { ok: true };
  }
  if (req.action === "createUser" || req.action === "updateUser") {
    permission(user, "manage");
    // PHP gateway sends the password only inside the signed HTTPS envelope.
    // Existing Node gateway and stored scrypt hashes remain compatible.
    if (d.password !== undefined) {
      if (
        typeof d.password !== "string" ||
        d.password.length < 8 ||
        d.password.length > 128
      )
        fail("Пароль должен содержать от 8 до 128 символов.");
      if (!deps.hashPassword)
        fail("Обновите Google backend для PHP-хостинга.", 503);
      d.passwordHash = deps.hashPassword(d.password);
    }
    const login = text(d.login, 80),
      name = text(d.name, 100);
    if (
      db.users.some((u) => u.login === login && !u.deleted_at && u.id !== d.id)
    )
      fail("Этот логин уже занят.", 409);
    if (req.action === "createUser") {
      if (!roleIds.includes(d.role as UserRole))
        fail("Выберите доступную роль.");
      db.users.push({
        id: deps.uuid(),
        name,
        login,
        password_hash: pwdHash(d.passwordHash),
        role: d.role as UserRole,
        active_station_id: null,
      });
    } else {
      const target = db.users.find((u) => u.id === uuid(d.id) && !u.deleted_at);
      if (!target) fail("Аккаунт не найден.", 404);
      const role = (d.role ?? target.role) as UserRole;
      if (!roleIds.includes(role)) fail("Выберите доступную роль.");
      if (
        target.role === "sous_chef" &&
        role !== "sous_chef" &&
        !db.users.some(
          (u) => u.id !== target.id && u.role === "sous_chef" && !u.deleted_at,
        )
      )
        fail("Нельзя изменить роль последнего су-шефа.", 409);
      if (role !== target.role) {
        target.role = role;
        target.active_station_id = null;
        db.sessions = db.sessions.filter((s) => s.user_id !== target.id);
      }
      target.name = name;
      target.login = login;
      if (d.passwordHash) {
        target.password_hash = pwdHash(d.passwordHash);
        db.sessions = db.sessions.filter((s) => s.user_id !== target.id);
      }
    }
    return { ok: true };
  }
  if (req.action === "task") {
    permission(user, "manage");
    if (d.action === "create") {
      const stationId = uuid(d.stationId);
      if (!db.stations.some((s) => s.id === stationId))
        fail("Станция не найдена.", 404);
      if (d.taskType !== "main" && d.taskType !== "individual")
        fail("Некорректный тип задачи.");
      db.station_tasks.push({
        id: deps.uuid(),
        station_id: stationId,
        title: text(d.title),
        task_type: d.taskType,
        sort_order:
          Math.max(
            -1,
            ...db.station_tasks
              .filter((t) => t.station_id === stationId)
              .map((t) => t.sort_order),
          ) + 1,
        is_active: true,
        created_work_date: date,
        inactive_work_date: null,
      });
    } else {
      const task = db.station_tasks.find(
        (t) => t.id === uuid(d.id) && t.is_active,
      );
      if (!task) fail("Задача не найдена.", 404);
      if (d.action === "rename") task.title = text(d.title);
      else if (d.action === "delete") {
        task.is_active = false;
        task.inactive_work_date = date;
      } else if (d.action === "move") {
        if (d.direction !== "up" && d.direction !== "down")
          fail("Некорректный порядок.");
        const rows = db.station_tasks
          .filter((t) => t.station_id === task.station_id && t.is_active)
          .sort(
            (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id),
          );
        const i = rows.indexOf(task),
          j = i + (d.direction === "up" ? -1 : 1);
        if (j >= 0 && j < rows.length) {
          [rows[i], rows[j]] = [rows[j], rows[i]];
          rows.forEach((t, i) => (t.sort_order = i));
        }
      } else fail("Некорректное действие.");
    }
    return { ok: true };
  }
  if (req.action === "additionalType") {
    permission(user, "manage");
    const title = text(d.title);
    if (typeof d.isActive !== "boolean") fail("Укажите активность типа.");
    if (
      db.additional_task_types.some(
        (t) => t.title.toLowerCase() === title.toLowerCase() && t.id !== d.id,
      )
    )
      fail("Тип с таким названием уже существует.", 409);
    if (d.id) {
      const type = db.additional_task_types.find((t) => t.id === uuid(d.id));
      if (!type) fail("Тип не найден.", 404);
      for (const task of db.additional_tasks)
        if (task.task_type_id === type.id && !task.title_snapshot)
          task.title_snapshot = type.title;
      type.title = title;
      type.is_active = d.isActive;
    } else
      db.additional_task_types.push({
        id: deps.uuid(),
        title,
        is_active: d.isActive,
      });
    return { ok: true };
  }
  if (req.action === "assignAdditional") {
    permission(user, "manage");
    const typeId = uuid(d.typeId);
    if (!db.additional_task_types.some((t) => t.id === typeId && t.is_active))
      fail("Тип задачи не найден.", 404);
    if (
      !Array.isArray(d.userIds) ||
      d.userIds.length < 1 ||
      d.userIds.length > 200
    )
      fail("Выберите поваров.");
    const ids = [...new Set(d.userIds.map(uuid))];
    if (
      ids.some(
        (id) =>
          !db.users.some(
            (u) => u.id === id && u.role === "cook" && !u.deleted_at,
          ),
      )
    )
      fail("Можно назначить задачу только поварам.");
    const id = deps.uuid();
    db.additional_tasks.push({
      id,
      task_type_id: typeId,
      title_snapshot: db.additional_task_types.find((t) => t.id === typeId)!
        .title,
      completed_by_user_id: null,
      work_date: date,
      photo_path: null,
      completed_at: null,
    });
    db.additional_task_assignees.push(
      ...ids.map((user_id) => ({ additional_task_id: id, user_id })),
    );
    return { ok: true };
  }
  if (req.action === "complete") {
    const category = text(d.category, 30),
      id = uuid(d.id);
    authorizeTask(db, user, category, id, date);
    if (d.photosBase64 !== undefined && d.photoBase64 !== undefined)
      fail("Передайте один список фотографий.");
    const images =
      d.photosBase64 ?? (d.photoBase64 === undefined ? [] : [d.photoBase64]);
    if (
      !Array.isArray(images) ||
      images.length < 1 ||
      images.length > MAX_TASK_PHOTOS
    )
      fail("Прикрепите от 1 до 4 фотографий.");
    const validated = images.map((image) => text(image, 4 * 1024 * 1024));
    if (d.mimeType !== "image/webp") fail("Требуется сжатая фотография WebP.");
    const files: string[] = [];
    try {
      for (const image of validated)
        files.push(
          deps.savePhoto(
            image,
            `${date}_${category}_${id}_${deps.uuid()}.webp`,
          ),
        );
      const savedAt = deps.now(),
        savedDate = workDate(savedAt);
      authorizeTask(db, user, category, id, savedDate);
      const file = encodePhotoPaths(files);
      if (category === "additional") {
        const t = db.additional_tasks.find((t) => t.id === id)!;
        t.photo_path = file;
        t.completed_at = savedAt.toISOString();
        t.completed_by_user_id = user.id;
      } else {
        const table =
          category === "station"
            ? db.station_task_completions
            : db.refrigerator_task_completions;
        table.push({
          id: deps.uuid(),
          task_id: id,
          work_date: savedDate,
          photo_path: file,
          completed_at: savedAt.toISOString(),
          completed_by_user_id: user.id,
        });
      }
      return { ok: true };
    } catch (e) {
      files.forEach((file) => deps.trashPhoto(file));
      throw e;
    }
  }
  fail("Неизвестное действие API.", 404, "NOT_FOUND");
}
export function execute(
  db: Tables,
  deps: Dependencies,
  req: BackendRequest,
): ApiResult {
  const before = JSON.parse(JSON.stringify(db)) as Tables;
  try {
    let key: string | undefined, fingerprint: string | undefined;
    if (
      writeActions.includes(req.action) &&
      !["login", "logout", "bootstrap", "snapshot"].includes(req.action)
    ) {
      current(db, deps, req.token);
      uuid(req.requestId);
      key = deps.hash((req.token ?? "") + ":" + req.requestId);
      const fingerprintData = { ...req.data };
      delete fingerprintData.passwordHash;
      if (fingerprintData.password !== undefined) {
        if (!deps.credentialFingerprint)
          fail("Обновите Google backend для PHP-хостинга.", 503);
        fingerprintData.credentialFingerprint = deps.credentialFingerprint(
          String(fingerprintData.password),
        );
        delete fingerprintData.password;
      }
      fingerprint = deps.hash(
        JSON.stringify({ action: req.action, data: fingerprintData }),
      );
      const previous = db.operations.find(
        (o) => o.id === key && o.expires_at > deps.now().toISOString(),
      );
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          fail("Ключ запроса уже использован.", 409, "IDEMPOTENCY_CONFLICT");
        return {
          success: true,
          data: JSON.parse(previous.response),
          error: null,
        };
      }
    }
    const data = dispatch(db, deps, req);
    if (key && fingerprint) {
      db.operations = db.operations.filter(
        (o) => o.expires_at > deps.now().toISOString(),
      );
      db.operations.push({
        id: key,
        fingerprint,
        response: JSON.stringify(data),
        expires_at: new Date(deps.now().getTime() + 86400000).toISOString(),
      });
    }
    return { success: true, data, error: null };
  } catch (e) {
    if (!(e instanceof BackendError) || !e.persist) Object.assign(db, before);
    if (e instanceof BackendError)
      return {
        success: false,
        data: null,
        error: { code: e.code, message: e.message, status: e.status },
      };
    throw e;
  }
}
