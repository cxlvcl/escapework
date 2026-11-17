"use strict";
var EscapeBackend = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // google/src/main.ts
  var main_exports = {};
  __export(main_exports, {
    cancelMysqlMigrationFreeze: () => cancelMysqlMigrationFreeze,
    doGet: () => doGet,
    doPost: () => doPost,
    prepareMysqlMigrationExport: () => prepareMysqlMigrationExport,
    setupDatabase: () => setupDatabase,
    snapshotPreviousDay: () => snapshotPreviousDay
  });

  // lib/domain.ts
  var roleLabels = {
    cook: "\u041F\u043E\u0432\u0430\u0440",
    sous_chef: "\u0421\u0443-\u0448\u0435\u0444",
    chef: "\u0428\u0435\u0444-\u043F\u043E\u0432\u0430\u0440",
    audit: "\u0410\u0443\u0434\u0438\u0442"
  };
  function allowed(role, permission2) {
    return permission2 === "manage" ? role === "sous_chef" : permission2 === "monitor" || permission2 === "activity" ? role !== "cook" : role === "cook";
  }
  var WORK_DAY_START_HOUR = 4;
  var PHOTO_ARCHIVE_DAYS = 32;
  function isCalendarDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
      return false;
    const time = Date.parse(`${value}T12:00:00Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  }
  function workDate(now = /* @__PURE__ */ new Date()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Moscow",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date(now.getTime() - WORK_DAY_START_HOUR * 60 * 60 * 1e3));
  }
  function workDayStart(date) {
    return /* @__PURE__ */ new Date(
      `${date}T${String(WORK_DAY_START_HOUR).padStart(2, "0")}:00:00+03:00`
    );
  }
  function dateOffset(date, days) {
    const d = /* @__PURE__ */ new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  function progress(completed, total) {
    return {
      completed,
      total,
      remaining: Math.max(0, total - completed),
      percent: total === 0 ? 0 : Math.round(completed / total * 100)
    };
  }
  function getActivityLevel(count) {
    if (count <= 10) return "low";
    if (count <= 17) return "medium";
    return "high";
  }
  function calendarWeek(now = /* @__PURE__ */ new Date()) {
    const date = workDate(now);
    const day = (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
    const start = dateOffset(date, -((day + 6) % 7));
    return { start, end: dateOffset(start, 7) };
  }

  // google/src/activity.ts
  function weeklyActivity(db, now) {
    const { start, end } = calendarWeek(now);
    const from = workDayStart(start).getTime();
    const until = workDayStart(end).getTime();
    const counts2 = /* @__PURE__ */ new Map();
    for (const records of [
      db.station_task_completions,
      db.refrigerator_task_completions,
      db.additional_tasks
    ]) {
      const seen = /* @__PURE__ */ new Set();
      for (const record of records) {
        if (seen.has(record.id)) continue;
        seen.add(record.id);
        if (!record.completed_by_user_id || !record.completed_at) continue;
        const time = Date.parse(record.completed_at);
        if (time >= from && time < until)
          counts2.set(
            record.completed_by_user_id,
            (counts2.get(record.completed_by_user_id) ?? 0) + 1
          );
      }
    }
    const summary = { low: 0, medium: 0, high: 0 };
    const users = db.users.filter((user) => user.role === "cook" && !user.deleted_at).map((user) => {
      const level = getActivityLevel(counts2.get(user.id) ?? 0);
      summary[level]++;
      return { id: user.id, name: user.name, role: user.role, level };
    }).sort((a, b) => a.name.localeCompare(b.name, "ru"));
    return { start, end, summary, users };
  }

  // lib/task-photos.ts
  var MAX_TASK_PHOTOS = 4;
  var MAX_PHOTO_BYTES = 3 * 1024 * 1024;
  var MAX_PHOTO_REQUEST_BYTES = 13 * 1024 * 1024;
  function photoPaths(value) {
    if (!value) return [];
    if (!value.startsWith("[")) return [value];
    const paths = JSON.parse(value);
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > MAX_TASK_PHOTOS || paths.some((path) => typeof path !== "string" || !path))
      throw new Error("Invalid stored photo references");
    return paths;
  }
  function encodePhotoPaths(paths) {
    if (paths.length < 1 || paths.length > MAX_TASK_PHOTOS)
      throw new Error("Invalid photo count");
    return paths.length === 1 ? paths[0] : JSON.stringify(paths);
  }

  // google/src/photos.ts
  function completedPhotos(db, date) {
    const result = [];
    const stationTasks = new Map(db.station_tasks.map((t) => [t.id, t]));
    const fridgeTasks2 = new Map(db.refrigerator_tasks.map((t) => [t.id, t]));
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
        photoCount: photoPaths(c.photo_path).length
      });
    }
    for (const c of db.refrigerator_task_completions) {
      const t = fridgeTasks2.get(c.task_id);
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
        photoCount: photoPaths(c.photo_path).length
      });
    }
    for (const t of db.additional_tasks) {
      if (t.work_date !== date || !t.completed_at || !t.photo_path) continue;
      result.push({
        id: t.id,
        title: t.title_snapshot ?? db.additional_task_types.find((type) => type.id === t.task_type_id).title,
        category: "additional",
        completedAt: t.completed_at,
        photoId: t.id,
        photoCount: photoPaths(t.photo_path).length,
        assignees: db.additional_task_assignees.filter((a) => a.additional_task_id === t.id).map((a) => db.users.find((u) => u.id === a.user_id).name)
      });
    }
    return result.sort(
      (a, b) => (a.refrigeratorNumber ?? 0) - (b.refrigeratorNumber ?? 0) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id.localeCompare(b.id)
    );
  }

  // google/src/seed-data.ts
  var stationSeed = [
    {
      name: "\u0413\u043E\u0440\u044F\u0447\u0438\u0439 \u0446\u0435\u0445 \u0413\u0440\u0435\u0446\u0438\u044F",
      extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u043F\u043E\u0434 \u043F\u043B\u0438\u0442\u0430\u043C\u0438.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0432\u044B\u0442\u044F\u0436\u0435\u043A.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0444\u0440\u0438\u0442\u044E\u0440\u0430."],
      fridges: [26, 27, 29]
    },
    {
      name: "\u0425\u043E\u043B\u043E\u0434\u043D\u044B\u0439 \u0446\u0435\u0445 \u0413\u0440\u0435\u0446\u0438\u044F",
      extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0444\u0440\u0438\u0442\u044E\u0440\u0430.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0442 \u043F\u0430\u043D."],
      fridges: [12, 17, 23, 31, 32]
    },
    {
      name: "\u041F\u0438\u0446\u0446\u0430 \u0446\u0435\u0445 \u0413\u0440\u0435\u0446\u0438\u044F",
      extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u043F\u0435\u0447\u0438."],
      fridges: [18, 19, 28, 34, 35, 36]
    },
    { name: "\u0425\u043E\u0441\u043F\u0435\u0440 \u0413\u0440\u0435\u0446\u0438\u044F", extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0445\u043E\u0441\u043F\u0435\u0440\u0430."], fridges: [20, 24, 30] },
    { name: "Raw Bar \u0413\u0440\u0435\u0446\u0438\u044F", extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0432\u0438\u0442\u0440\u0438\u043D\u044B."], fridges: [37] },
    { name: "\u0413\u043E\u0440\u044F\u0447\u0438\u0439 \u0446\u0435\u0445 \u0437\u0430\u0432\u0442\u0440\u0430\u043A\u0438", extra: [], fridges: [25, 13] },
    {
      name: "\u0425\u043E\u043B\u043E\u0434\u043D\u044B\u0439 \u0446\u0435\u0445 \u0437\u0430\u0432\u0442\u0440\u0430\u043A\u0438",
      extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0444\u0440\u0438\u0442\u044E\u0440\u0430.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0442 \u043F\u0430\u043D."],
      fridges: [14, 22]
    },
    {
      name: "\u0413\u043E\u0440\u044F\u0447\u0438\u0439 \u0446\u0435\u0445 \u0410\u0437\u0438\u044F",
      extra: ["\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u043F\u043E\u0434 \u043F\u043B\u0438\u0442\u0430\u043C\u0438.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0432\u044B\u0442\u044F\u0436\u0435\u043A.", "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0444\u0440\u0438\u0442\u044E\u0440\u0430."],
      fridges: [6, 7, 8, 9]
    },
    { name: "\u0421\u0443\u0448\u0438 \u0431\u0430\u0440 \u0410\u0437\u0438\u044F", extra: [], fridges: [2, 3, 4, 5, 10, 11] }
  ];
  var commonTasks = [
    "\u041E\u0431\u0449\u0430\u044F \u0447\u0438\u0441\u0442\u043E\u0442\u0430 \u0441\u0442\u0430\u043D\u0446\u0438\u0438/\u0441\u0442\u043E\u043B\u043E\u0432.",
    "\u041B\u0438\u0441\u0442 \u043C\u043E\u043D\u0438\u0442\u043E\u0440\u0438\u043D\u0433\u0430 \u0442\u0435\u043C\u043F\u0435\u0440\u0430\u0442\u0443\u0440\u043D\u043E\u0433\u043E \u0440\u0435\u0436\u0438\u043C\u0430."
  ];
  var fridgeTasks = [
    "\u041D\u0430\u043B\u0438\u0447\u0438\u0435 \u0430\u043A\u0442\u0443\u0430\u043B\u044C\u043D\u044B\u0445 \u043C\u0430\u0440\u043A\u0438\u0440\u043E\u0432\u043E\u043A.",
    "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0432 \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0435.",
    "\u0427\u0438\u0441\u0442\u043E\u0442\u0430 \u0437\u0430 \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u043E\u043C."
  ];
  var additionalTypes = [
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043A\u0430\u043C\u0435\u0440\u044B",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043C\u043E\u0440\u043E\u0437\u043D\u043E\u0439 \u043A\u0430\u043C\u0435\u0440\u044B",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u0441\u0443\u0445\u043E\u0433\u043E \u0441\u043A\u043B\u0430\u0434\u0430",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u0440\u044B\u0431\u043D\u043E\u0433\u043E \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043C\u044F\u0441\u043D\u043E\u0433\u043E \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043E\u0432\u043E\u0449\u043D\u043E\u0433\u043E \u0445\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A\u0430",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043F\u0430\u0440\u043E\u043A\u043E\u043D\u0432\u0435\u043A\u0442\u043E\u043C\u0430\u0442\u043E\u0432",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u0444\u0440\u0438\u0442\u044E\u0440\u0430",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043A\u0430\u043C\u0435\u0440\u044B \u0448\u043E\u043A\u043E\u0432\u043E\u0439 \u0437\u0430\u043C\u043E\u0440\u043E\u0437\u043A\u0438",
    "\u0423\u0431\u043E\u0440\u043A\u0430 \u043B\u0451\u0434\u043E\u0433\u0435\u043D\u0435\u0440\u0430\u0442\u043E\u0440\u0430"
  ];

  // google/src/core.ts
  var BackendError = class extends Error {
    constructor(code, message, status = 400, persist = false) {
      super(message);
      __publicField(this, "code", code);
      __publicField(this, "status", status);
      __publicField(this, "persist", persist);
    }
  };
  function fail(message, status = 400, code = "INVALID_INPUT") {
    throw new BackendError(code, message, status);
  }
  var roleIds = Object.keys(roleLabels);
  var roleOptions = roleIds.map((id) => ({ id, name: roleLabels[id] }));
  function text(v, max = 300) {
    if (typeof v !== "string" || !v.trim() || v.trim().length > max)
      fail("\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u043F\u043E\u043B\u044F.");
    return v.trim();
  }
  function uuid(v) {
    const s = text(v, 80);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s
    ))
      fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0438\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440.");
    return s;
  }
  function pwdHash(v) {
    if (typeof v !== "string" || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(v))
      fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0445\u0435\u0448 \u043F\u0430\u0440\u043E\u043B\u044F.");
    return v;
  }
  function viewUser(u) {
    return {
      id: u.id,
      name: u.name,
      login: u.login,
      role: u.role,
      activeStationId: u.active_station_id
    };
  }
  function permission(user, p) {
    if (!allowed(user.role, p)) fail("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403, "FORBIDDEN");
  }
  function current(db, deps2, token) {
    if (!token) fail("\u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0432 \u0441\u0438\u0441\u0442\u0435\u043C\u0443.", 401, "UNAUTHORIZED");
    const session = db.sessions.find(
      (s) => s.token_hash === deps2.hash(token) && s.expires_at > deps2.now().toISOString()
    );
    const user = db.users.find((u) => u.id === session?.user_id && !u.deleted_at);
    if (!user) fail("\u0421\u0435\u0441\u0441\u0438\u044F \u0438\u0441\u0442\u0435\u043A\u043B\u0430. \u0412\u043E\u0439\u0434\u0438\u0442\u0435 \u0441\u043D\u043E\u0432\u0430.", 401, "UNAUTHORIZED");
    return user;
  }
  function seed(db, deps2) {
    for (const station of stationSeed) {
      let row = db.stations.find((s) => s.name === station.name);
      if (!row) {
        row = { id: deps2.uuid(), name: station.name };
        db.stations.push(row);
        for (const [i, title] of [...commonTasks, ...station.extra].entries())
          db.station_tasks.push({
            id: deps2.uuid(),
            station_id: row.id,
            title,
            task_type: "main",
            sort_order: i,
            is_active: true,
            created_work_date: workDate(deps2.now()),
            inactive_work_date: null
          });
      }
      for (const number of station.fridges) {
        let fridge = db.refrigerators.find((r) => r.number === number);
        if (!fridge) {
          fridge = { id: deps2.uuid(), number, station_id: row.id };
          db.refrigerators.push(fridge);
        }
        for (const [i, title] of fridgeTasks.entries())
          if (!db.refrigerator_tasks.some(
            (t) => t.refrigerator_id === fridge.id && t.sort_order === i
          ))
            db.refrigerator_tasks.push({
              id: deps2.uuid(),
              refrigerator_id: fridge.id,
              title,
              sort_order: i
            });
      }
    }
    for (const [index, title] of additionalTypes.entries()) {
      const id = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
      if (!db.additional_task_types.some((t) => t.id === id))
        db.additional_task_types.push({ id, title, is_active: true });
    }
  }
  function stationOrder(db) {
    return [...db.stations].sort(
      (a, b) => stationSeed.findIndex((s) => s.name === a.name) - stationSeed.findIndex((s) => s.name === b.name)
    );
  }
  function counts(db, date) {
    const stations = db.stations.map((s) => {
      const tasks = db.station_tasks.filter(
        (t) => t.station_id === s.id && t.created_work_date <= date && (!t.inactive_work_date || t.inactive_work_date > date)
      );
      const fridges = db.refrigerator_tasks.filter(
        (t) => db.refrigerators.some(
          (r) => r.id === t.refrigerator_id && r.station_id === s.id
        )
      );
      const completed = tasks.filter(
        (t) => db.station_task_completions.some(
          (c) => c.task_id === t.id && c.work_date === date
        )
      ).length + fridges.filter(
        (t) => db.refrigerator_task_completions.some(
          (c) => c.task_id === t.id && c.work_date === date
        )
      ).length;
      return { id: s.id, ...progress(completed, tasks.length + fridges.length) };
    });
    const extra = db.additional_tasks.filter((t) => t.work_date === date);
    return {
      stations,
      overall: progress(
        stations.reduce((n, s) => n + s.completed, 0) + extra.filter((t) => t.completed_at).length,
        stations.reduce((n, s) => n + s.total, 0) + extra.length
      )
    };
  }
  function finalizeClosedStatistics(db, today) {
    const oldest = dateOffset(today, -32);
    let first = today;
    for (const task of db.station_tasks)
      if (task.created_work_date < first) first = task.created_work_date;
    for (const records of [
      db.station_task_completions,
      db.refrigerator_task_completions,
      db.additional_tasks
    ])
      for (const record of records)
        if (record.work_date < first) first = record.work_date;
    const saved = new Set(db.daily_statistics.map((s) => s.work_date));
    for (let date = first < oldest ? oldest : first; date < today; date = dateOffset(date, 1)) {
      if (saved.has(date)) continue;
      const p = counts(db, date);
      for (const s of p.stations)
        db.daily_station_statistics.push({
          work_date: date,
          station_id: s.id,
          completed_tasks: s.completed,
          total_tasks: s.total
        });
      db.daily_statistics.push({
        work_date: date,
        completed_tasks: p.overall.completed,
        total_tasks: p.overall.total
      });
    }
    db.daily_statistics = db.daily_statistics.filter(
      (s) => s.work_date >= oldest
    );
    db.daily_station_statistics = db.daily_station_statistics.filter(
      (s) => s.work_date >= oldest
    );
  }
  function snapshot(db, deps2) {
    const now = deps2.now(), today = workDate(now);
    finalizeClosedStatistics(db, today);
    db.sessions = db.sessions.filter((s) => s.expires_at > now.toISOString());
    db.login_attempts = db.login_attempts.filter(
      (s) => s.reset_at > now.toISOString()
    );
    db.operations = db.operations.filter((s) => s.expires_at > now.toISOString());
    return { ok: true, workDate: dateOffset(today, -1) };
  }
  function taskViews(db, user, date) {
    const tasks = db.station_tasks.filter(
      (t) => t.is_active && (user.role !== "cook" || t.station_id === user.active_station_id)
    ).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map((t) => {
      const c = db.station_task_completions.find(
        (c2) => c2.task_id === t.id && c2.work_date === date
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
        photoCount: photoPaths(c?.photo_path).length
      };
    });
    const fridges = db.refrigerator_tasks.filter(
      (t) => db.refrigerators.some(
        (r) => r.id === t.refrigerator_id && (user.role !== "cook" || r.station_id === user.active_station_id)
      )
    ).sort((a, b) => a.sort_order - b.sort_order).map((t) => {
      const r = db.refrigerators.find((r2) => r2.id === t.refrigerator_id);
      const c = db.refrigerator_task_completions.find(
        (c2) => c2.task_id === t.id && c2.work_date === date
      );
      return {
        id: t.id,
        title: t.title,
        category: "refrigerator",
        stationId: r.station_id,
        refrigeratorId: r.id,
        refrigeratorNumber: r.number,
        completedAt: c?.completed_at ?? null,
        photoId: c?.id ?? null,
        photoCount: photoPaths(c?.photo_path).length
      };
    }).sort((a, b) => a.refrigeratorNumber - b.refrigeratorNumber);
    return { tasks, fridges };
  }
  function additionalView(db, user, date) {
    return db.additional_tasks.filter(
      (t) => t.work_date === date && (user.role !== "cook" || db.additional_task_assignees.some(
        (a) => a.additional_task_id === t.id && a.user_id === user.id
      ))
    ).map((t) => ({
      id: t.id,
      title: t.title_snapshot ?? db.additional_task_types.find((x) => x.id === t.task_type_id).title,
      category: "additional",
      completedAt: t.completed_at,
      photoId: t.completed_at ? t.id : null,
      photoCount: photoPaths(t.photo_path).length,
      ...user.role === "cook" ? {} : {
        assignees: db.additional_task_assignees.filter((a) => a.additional_task_id === t.id).map((a) => db.users.find((u) => u.id === a.user_id).name)
      }
    }));
  }
  function authorizeTask(db, user, category, id, date) {
    permission(user, "complete");
    if (category === "station") {
      const t = db.station_tasks.find((t2) => t2.id === id && t2.is_active);
      if (!t || !user.active_station_id || t.station_id !== user.active_station_id)
        fail("\u0417\u0430\u0434\u0430\u0447\u0430 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u043D\u0430 \u0432\u0430\u0448\u0435\u0439 \u0441\u0442\u0430\u043D\u0446\u0438\u0438.", 403, "FORBIDDEN");
      if (db.station_task_completions.some(
        (c) => c.task_id === id && c.work_date === date
      ))
        fail("\u042D\u0442\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430.", 409, "ALREADY_COMPLETED");
    } else if (category === "refrigerator") {
      const t = db.refrigerator_tasks.find((t2) => t2.id === id);
      const fridge = db.refrigerators.find((r) => r.id === t?.refrigerator_id);
      if (!fridge || !user.active_station_id || fridge.station_id !== user.active_station_id)
        fail("\u0425\u043E\u043B\u043E\u0434\u0438\u043B\u044C\u043D\u0438\u043A \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u043D\u0430 \u0432\u0430\u0448\u0435\u0439 \u0441\u0442\u0430\u043D\u0446\u0438\u0438.", 403, "FORBIDDEN");
      if (db.refrigerator_task_completions.some(
        (c) => c.task_id === id && c.work_date === date
      ))
        fail("\u042D\u0442\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430.", 409, "ALREADY_COMPLETED");
    } else if (category === "additional") {
      const t = db.additional_tasks.find((t2) => t2.id === id);
      if (!t || !db.additional_task_assignees.some(
        (a) => a.additional_task_id === id && a.user_id === user.id
      ))
        fail("\u0417\u0430\u0434\u0430\u0447\u0430 \u0432\u0430\u043C \u043D\u0435 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0430.", 403, "FORBIDDEN");
      if (t.work_date !== date || t.completed_at)
        fail(
          "\u042D\u0442\u0430 \u0437\u0430\u0434\u0430\u0447\u0430 \u0443\u0436\u0435 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0430 \u0438\u043B\u0438 \u043E\u0442\u043D\u043E\u0441\u0438\u0442\u0441\u044F \u043A \u043F\u0440\u043E\u0448\u0435\u0434\u0448\u0435\u043C\u0443 \u0434\u043D\u044E.",
          409,
          "ALREADY_COMPLETED"
        );
    } else fail("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u0430\u0442\u0435\u0433\u043E\u0440\u0438\u044F \u0437\u0430\u0434\u0430\u0447\u0438.");
  }
  var writeActions = [
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
    "snapshot"
  ];
  function dispatch(db, deps2, req) {
    const d = req.data, now = deps2.now(), date = workDate(now);
    if (req.action === "bootstrap") {
      if (!deps2.bootstrapEnabled) fail("\u041F\u0435\u0440\u0432\u043E\u043D\u0430\u0447\u0430\u043B\u044C\u043D\u0430\u044F \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0430.", 403);
      if (db.users.some((u) => u.role === "sous_chef" && !u.deleted_at))
        return { ok: true, created: false };
      const login = text(d.login, 80);
      if (db.users.some((u) => u.login === login && !u.deleted_at))
        fail("\u042D\u0442\u043E\u0442 \u043B\u043E\u0433\u0438\u043D \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442.", 409);
      db.users.push({
        id: deps2.uuid(),
        name: text(d.name, 100),
        login,
        password_hash: pwdHash(d.passwordHash),
        role: "sous_chef",
        active_station_id: null
      });
      return { ok: true, created: true };
    }
    if (req.action === "snapshot") return snapshot(db, deps2);
    if (req.action === "login") {
      const login = text(d.login, 80);
      if (typeof d.password !== "string" || d.password.length > 128 || !d.password)
        fail("\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0437\u0430\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u043F\u043E\u043B\u044F.");
      const key = deps2.hash("login:" + login);
      let a = db.login_attempts.find((a2) => a2.key === key);
      if (!a) {
        a = {
          key,
          attempts: 0,
          reset_at: new Date(now.getTime() + 9e5).toISOString()
        };
        db.login_attempts.push(a);
      }
      if (a.reset_at <= now.toISOString()) {
        a.attempts = 0;
        a.reset_at = new Date(now.getTime() + 9e5).toISOString();
      }
      a.attempts++;
      if (a.attempts > 10)
        throw new BackendError(
          "RATE_LIMIT",
          "\u0421\u043B\u0438\u0448\u043A\u043E\u043C \u043C\u043D\u043E\u0433\u043E \u043F\u043E\u043F\u044B\u0442\u043E\u043A. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0447\u0435\u0440\u0435\u0437 15 \u043C\u0438\u043D\u0443\u0442.",
          429,
          true
        );
      const user2 = db.users.find((u) => u.login === login && !u.deleted_at);
      const valid = deps2.verify(
        d.password,
        user2?.password_hash ?? "scrypt:" + "0".repeat(32) + ":" + "0".repeat(128)
      );
      if (!user2 || !valid)
        throw new BackendError(
          "BAD_LOGIN",
          "\u041D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u043B\u043E\u0433\u0438\u043D \u0438\u043B\u0438 \u043F\u0430\u0440\u043E\u043B\u044C.",
          401,
          true
        );
      const token = text(d.sessionToken, 128);
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0441\u0435\u0441\u0441\u0438\u044F.");
      const expiresAt = new Date(now.getTime() + 7 * 864e5).toISOString();
      db.sessions = db.sessions.filter((s) => s.expires_at > now.toISOString());
      db.sessions.push({
        token_hash: deps2.hash(token),
        user_id: user2.id,
        expires_at: expiresAt
      });
      db.login_attempts = db.login_attempts.filter((a2) => a2.key !== key);
      return { user: viewUser(user2), expiresAt };
    }
    if (req.action === "logout") {
      db.sessions = db.sessions.filter(
        (s) => s.token_hash !== deps2.hash(req.token ?? "")
      );
      return { ok: true };
    }
    const user = current(db, deps2, req.token);
    if (req.action === "getCurrentUser") return viewUser(user);
    if (req.action === "getKitchen")
      return {
        user: viewUser(user),
        date,
        stations: stationOrder(db),
        ...taskViews(db, user, date),
        stats: user.role === "cook" ? null : counts(db, date)
      };
    if (req.action === "getAdditional")
      return {
        tasks: additionalView(db, user, date),
        types: user.role === "sous_chef" ? db.additional_task_types : [],
        cooks: user.role === "sous_chef" ? db.users.filter((u) => u.role === "cook" && !u.deleted_at).map((u) => ({ id: u.id, name: u.name })) : []
      };
    if (req.action === "getActivity") {
      permission(user, "activity");
      return weeklyActivity(db, now);
    }
    if (req.action === "getPhotos") {
      permission(user, "monitor");
      const selected = d.date === void 0 ? date : d.date;
      const oldestDate = dateOffset(date, -PHOTO_ARCHIVE_DAYS);
      if (!isCalendarDate(selected) || selected < oldestDate || selected > date)
        fail("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u0430\u0442\u0443 \u0437\u0430 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0435 32 \u0440\u0430\u0431\u043E\u0447\u0438\u0445 \u0434\u043D\u044F \u0438\u043B\u0438 \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u0434\u0435\u043D\u044C.");
      return {
        date: selected,
        today: date,
        oldestDate,
        stations: stationOrder(db),
        tasks: completedPhotos(db, selected)
      };
    }
    if (req.action === "getUsers") {
      permission(user, "manage");
      return {
        users: db.users.filter((u) => !u.deleted_at).map(viewUser),
        roles: roleOptions
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
        fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434.");
      const stationId = d.stationId ? uuid(d.stationId) : void 0;
      if (stationId && !db.stations.some((s) => s.id === stationId))
        fail("\u0421\u0442\u0430\u043D\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.", 404);
      if (!deps2.readOnly) finalizeClosedStatistics(db, date);
      const start = dateOffset(
        date,
        period === "yesterday" ? -1 : period === "week" ? -6 : period === "month" ? -29 : 0
      );
      const end = period === "yesterday" ? start : date;
      const rows = stationId ? db.daily_station_statistics.filter((s) => s.station_id === stationId) : db.daily_statistics;
      const days = rows.filter(
        (s) => s.work_date >= start && s.work_date <= end && s.work_date < date
      ).map((s) => ({
        date: s.work_date,
        ...progress(s.completed_tasks, s.total_tasks),
        finalized: true
      }));
      if (end === date) {
        const live = counts(db, date);
        days.push({
          date,
          ...stationId ? live.stations.find((s) => s.id === stationId) : live.overall,
          finalized: false
        });
      }
      days.sort((a, b) => b.date.localeCompare(a.date));
      return {
        days,
        summary: progress(
          days.reduce((n, s) => n + s.completed, 0),
          days.reduce((n, s) => n + s.total, 0)
        ),
        pending: period !== "today" && !days.some((s) => s.date === dateOffset(date, -1))
      };
    }
    if (req.action === "getPhoto") {
      const id = uuid(d.id), category = d.category;
      const c = category === "station" ? db.station_task_completions.find((c2) => c2.id === id) : category === "refrigerator" ? db.refrigerator_task_completions.find((c2) => c2.id === id) : category === "additional" ? db.additional_tasks.find((t) => t.id === id) : void 0;
      if (!c?.photo_path) fail("\u0424\u043E\u0442\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", 404);
      if (user.role === "cook") {
        if (c.work_date !== date) fail("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
        if (category === "additional") {
          if (!db.additional_task_assignees.some(
            (a) => a.additional_task_id === id && a.user_id === user.id
          ))
            fail("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
        } else {
          const taskId = "task_id" in c ? c.task_id : "";
          const sid = category === "station" ? db.station_tasks.find((t) => t.id === taskId)?.station_id : db.refrigerators.find(
            (r) => r.id === db.refrigerator_tasks.find((t) => t.id === taskId)?.refrigerator_id
          )?.station_id;
          if (!user.active_station_id || sid !== user.active_station_id)
            fail("\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
        }
      }
      const index = d.index ?? 0;
      const paths = photoPaths(c.photo_path);
      if (!Number.isInteger(index) || typeof index !== "number" || index < 0 || index >= paths.length)
        fail("\u0424\u043E\u0442\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", 404, "NOT_FOUND");
      return deps2.getPhoto(paths[index]);
    }
    if (req.action === "shift") {
      permission(user, "shift");
      if (d.action === "close") {
        user.active_station_id = null;
      } else if (d.action === "open") {
        if (user.active_station_id) fail("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0437\u0430\u043A\u0440\u043E\u0439\u0442\u0435 \u0442\u0435\u043A\u0443\u0449\u0443\u044E \u0441\u043C\u0435\u043D\u0443.", 409);
        const id = uuid(d.stationId);
        if (!db.stations.some((s) => s.id === id))
          fail("\u0421\u0442\u0430\u043D\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.", 404);
        user.active_station_id = id;
      } else fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435.");
      return { ok: true };
    }
    if (req.action === "deleteUser") {
      permission(user, "manage");
      const target = db.users.find((u) => u.id === uuid(d.id));
      if (!target) fail("\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.", 404);
      if (target.deleted_at) return { ok: true };
      if (target.role === "sous_chef" && !db.users.some(
        (u) => u.id !== target.id && u.role === "sous_chef" && !u.deleted_at
      ))
        fail("\u041D\u0435\u043B\u044C\u0437\u044F \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0441\u0443-\u0448\u0435\u0444\u0430.", 409);
      target.deleted_at = now.toISOString();
      target.active_station_id = null;
      db.sessions = db.sessions.filter((s) => s.user_id !== target.id);
      return { ok: true };
    }
    if (req.action === "createUser" || req.action === "updateUser") {
      permission(user, "manage");
      if (d.password !== void 0) {
        if (typeof d.password !== "string" || d.password.length < 8 || d.password.length > 128)
          fail("\u041F\u0430\u0440\u043E\u043B\u044C \u0434\u043E\u043B\u0436\u0435\u043D \u0441\u043E\u0434\u0435\u0440\u0436\u0430\u0442\u044C \u043E\u0442 8 \u0434\u043E 128 \u0441\u0438\u043C\u0432\u043E\u043B\u043E\u0432.");
        if (!deps2.hashPassword)
          fail("\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 Google backend \u0434\u043B\u044F PHP-\u0445\u043E\u0441\u0442\u0438\u043D\u0433\u0430.", 503);
        d.passwordHash = deps2.hashPassword(d.password);
      }
      const login = text(d.login, 80), name = text(d.name, 100);
      if (db.users.some((u) => u.login === login && !u.deleted_at && u.id !== d.id))
        fail("\u042D\u0442\u043E\u0442 \u043B\u043E\u0433\u0438\u043D \u0443\u0436\u0435 \u0437\u0430\u043D\u044F\u0442.", 409);
      if (req.action === "createUser") {
        if (!roleIds.includes(d.role))
          fail("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0443\u044E \u0440\u043E\u043B\u044C.");
        db.users.push({
          id: deps2.uuid(),
          name,
          login,
          password_hash: pwdHash(d.passwordHash),
          role: d.role,
          active_station_id: null
        });
      } else {
        const target = db.users.find((u) => u.id === uuid(d.id) && !u.deleted_at);
        if (!target) fail("\u0410\u043A\u043A\u0430\u0443\u043D\u0442 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.", 404);
        const role = d.role ?? target.role;
        if (!roleIds.includes(role)) fail("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0443\u044E \u0440\u043E\u043B\u044C.");
        if (target.role === "sous_chef" && role !== "sous_chef" && !db.users.some(
          (u) => u.id !== target.id && u.role === "sous_chef" && !u.deleted_at
        ))
          fail("\u041D\u0435\u043B\u044C\u0437\u044F \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u043E\u043B\u044C \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u0441\u0443-\u0448\u0435\u0444\u0430.", 409);
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
          fail("\u0421\u0442\u0430\u043D\u0446\u0438\u044F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.", 404);
        if (d.taskType !== "main" && d.taskType !== "individual")
          fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0442\u0438\u043F \u0437\u0430\u0434\u0430\u0447\u0438.");
        db.station_tasks.push({
          id: deps2.uuid(),
          station_id: stationId,
          title: text(d.title),
          task_type: d.taskType,
          sort_order: Math.max(
            -1,
            ...db.station_tasks.filter((t) => t.station_id === stationId).map((t) => t.sort_order)
          ) + 1,
          is_active: true,
          created_work_date: date,
          inactive_work_date: null
        });
      } else {
        const task = db.station_tasks.find(
          (t) => t.id === uuid(d.id) && t.is_active
        );
        if (!task) fail("\u0417\u0430\u0434\u0430\u0447\u0430 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u0430.", 404);
        if (d.action === "rename") task.title = text(d.title);
        else if (d.action === "delete") {
          task.is_active = false;
          task.inactive_work_date = date;
        } else if (d.action === "move") {
          if (d.direction !== "up" && d.direction !== "down")
            fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u043F\u043E\u0440\u044F\u0434\u043E\u043A.");
          const rows = db.station_tasks.filter((t) => t.station_id === task.station_id && t.is_active).sort(
            (a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)
          );
          const i = rows.indexOf(task), j = i + (d.direction === "up" ? -1 : 1);
          if (j >= 0 && j < rows.length) {
            [rows[i], rows[j]] = [rows[j], rows[i]];
            rows.forEach((t, i2) => t.sort_order = i2);
          }
        } else fail("\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435.");
      }
      return { ok: true };
    }
    if (req.action === "additionalType") {
      permission(user, "manage");
      const title = text(d.title);
      if (typeof d.isActive !== "boolean") fail("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0430\u043A\u0442\u0438\u0432\u043D\u043E\u0441\u0442\u044C \u0442\u0438\u043F\u0430.");
      if (db.additional_task_types.some(
        (t) => t.title.toLowerCase() === title.toLowerCase() && t.id !== d.id
      ))
        fail("\u0422\u0438\u043F \u0441 \u0442\u0430\u043A\u0438\u043C \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u0435\u043C \u0443\u0436\u0435 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u0435\u0442.", 409);
      if (d.id) {
        const type = db.additional_task_types.find((t) => t.id === uuid(d.id));
        if (!type) fail("\u0422\u0438\u043F \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.", 404);
        for (const task of db.additional_tasks)
          if (task.task_type_id === type.id && !task.title_snapshot)
            task.title_snapshot = type.title;
        type.title = title;
        type.is_active = d.isActive;
      } else
        db.additional_task_types.push({
          id: deps2.uuid(),
          title,
          is_active: d.isActive
        });
      return { ok: true };
    }
    if (req.action === "assignAdditional") {
      permission(user, "manage");
      const typeId = uuid(d.typeId);
      if (!db.additional_task_types.some((t) => t.id === typeId && t.is_active))
        fail("\u0422\u0438\u043F \u0437\u0430\u0434\u0430\u0447\u0438 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.", 404);
      if (!Array.isArray(d.userIds) || d.userIds.length < 1 || d.userIds.length > 200)
        fail("\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u043F\u043E\u0432\u0430\u0440\u043E\u0432.");
      const ids = [...new Set(d.userIds.map(uuid))];
      if (ids.some(
        (id2) => !db.users.some(
          (u) => u.id === id2 && u.role === "cook" && !u.deleted_at
        )
      ))
        fail("\u041C\u043E\u0436\u043D\u043E \u043D\u0430\u0437\u043D\u0430\u0447\u0438\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E\u0432\u0430\u0440\u0430\u043C.");
      const id = deps2.uuid();
      db.additional_tasks.push({
        id,
        task_type_id: typeId,
        title_snapshot: db.additional_task_types.find((t) => t.id === typeId).title,
        completed_by_user_id: null,
        work_date: date,
        photo_path: null,
        completed_at: null
      });
      db.additional_task_assignees.push(
        ...ids.map((user_id) => ({ additional_task_id: id, user_id }))
      );
      return { ok: true };
    }
    if (req.action === "complete") {
      const category = text(d.category, 30), id = uuid(d.id);
      authorizeTask(db, user, category, id, date);
      if (d.photosBase64 !== void 0 && d.photoBase64 !== void 0)
        fail("\u041F\u0435\u0440\u0435\u0434\u0430\u0439\u0442\u0435 \u043E\u0434\u0438\u043D \u0441\u043F\u0438\u0441\u043E\u043A \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0439.");
      const images = d.photosBase64 ?? (d.photoBase64 === void 0 ? [] : [d.photoBase64]);
      if (!Array.isArray(images) || images.length < 1 || images.length > MAX_TASK_PHOTOS)
        fail("\u041F\u0440\u0438\u043A\u0440\u0435\u043F\u0438\u0442\u0435 \u043E\u0442 1 \u0434\u043E 4 \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0439.");
      const validated = images.map((image) => text(image, 4 * 1024 * 1024));
      if (d.mimeType !== "image/webp") fail("\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044F \u0441\u0436\u0430\u0442\u0430\u044F \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u044F WebP.");
      const files = [];
      try {
        for (const image of validated)
          files.push(
            deps2.savePhoto(
              image,
              `${date}_${category}_${id}_${deps2.uuid()}.webp`
            )
          );
        const savedAt = deps2.now(), savedDate = workDate(savedAt);
        authorizeTask(db, user, category, id, savedDate);
        const file = encodePhotoPaths(files);
        if (category === "additional") {
          const t = db.additional_tasks.find((t2) => t2.id === id);
          t.photo_path = file;
          t.completed_at = savedAt.toISOString();
          t.completed_by_user_id = user.id;
        } else {
          const table = category === "station" ? db.station_task_completions : db.refrigerator_task_completions;
          table.push({
            id: deps2.uuid(),
            task_id: id,
            work_date: savedDate,
            photo_path: file,
            completed_at: savedAt.toISOString(),
            completed_by_user_id: user.id
          });
        }
        return { ok: true };
      } catch (e) {
        files.forEach((file) => deps2.trashPhoto(file));
        throw e;
      }
    }
    fail("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 API.", 404, "NOT_FOUND");
  }
  function execute(db, deps2, req) {
    const before = JSON.parse(JSON.stringify(db));
    try {
      let key, fingerprint;
      if (writeActions.includes(req.action) && !["login", "logout", "bootstrap", "snapshot"].includes(req.action)) {
        current(db, deps2, req.token);
        uuid(req.requestId);
        key = deps2.hash((req.token ?? "") + ":" + req.requestId);
        const fingerprintData = { ...req.data };
        delete fingerprintData.passwordHash;
        if (fingerprintData.password !== void 0) {
          if (!deps2.credentialFingerprint)
            fail("\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 Google backend \u0434\u043B\u044F PHP-\u0445\u043E\u0441\u0442\u0438\u043D\u0433\u0430.", 503);
          fingerprintData.credentialFingerprint = deps2.credentialFingerprint(
            String(fingerprintData.password)
          );
          delete fingerprintData.password;
        }
        fingerprint = deps2.hash(
          JSON.stringify({ action: req.action, data: fingerprintData })
        );
        const previous = db.operations.find(
          (o) => o.id === key && o.expires_at > deps2.now().toISOString()
        );
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            fail("\u041A\u043B\u044E\u0447 \u0437\u0430\u043F\u0440\u043E\u0441\u0430 \u0443\u0436\u0435 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u043D.", 409, "IDEMPOTENCY_CONFLICT");
          return {
            success: true,
            data: JSON.parse(previous.response),
            error: null
          };
        }
      }
      const data = dispatch(db, deps2, req);
      if (key && fingerprint) {
        db.operations = db.operations.filter(
          (o) => o.expires_at > deps2.now().toISOString()
        );
        db.operations.push({
          id: key,
          fingerprint,
          response: JSON.stringify(data),
          expires_at: new Date(deps2.now().getTime() + 864e5).toISOString()
        });
      }
      return { success: true, data, error: null };
    } catch (e) {
      if (!(e instanceof BackendError) || !e.persist) Object.assign(db, before);
      if (e instanceof BackendError)
        return {
          success: false,
          data: null,
          error: { code: e.code, message: e.message, status: e.status }
        };
      throw e;
    }
  }

  // node_modules/@noble/hashes/utils.js
  function isBytes(a) {
    return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
  }
  var atitle = (title) => title ? `"${title}" ` : "";
  function anumber(n, title = "") {
    if (typeof n !== "number")
      throw new TypeError(atitle(title) + "expected number, got " + typeof n);
    if (!Number.isSafeInteger(n) || n < 0)
      throw new RangeError(atitle(title) + "expected integer >= 0, got " + n);
    return n;
  }
  function abytes(value, length, title = "") {
    if (isBytes(value) && (length === void 0 || value.length === length))
      return value;
    if (length !== void 0)
      anumber(length, "length");
    const bytes = isBytes(value);
    const ofLen = length !== void 0 ? ` of length ${length}` : "";
    const got = bytes ? `length=${value.length}` : `type=${typeof value}`;
    const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
    if (!bytes)
      throw new TypeError(message);
    throw new RangeError(message);
  }
  function ahash(h) {
    if (typeof h !== "function" || typeof h.create !== "function")
      throw new TypeError("expected hash wrapped by utils.createHasher");
    anumber(h.outputLen);
    anumber(h.blockLen);
    if (h.outputLen < 1 || h.blockLen < 1)
      throw new Error("hash blockLen / outputLen must be >= 1");
  }
  var aobject = (value, label) => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value);
  };
  var aopts = (value, label) => {
    aobject(value, label);
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null)
      throw new TypeError(`"${label}" expected plain object`);
    if (Object.hasOwn(value, "__proto__"))
      throw new TypeError(`"${label}.__proto__" is not allowed`);
  };
  function aexists(instance, checkFinished = true) {
    if (instance.destroyed)
      throw new Error("hash was destroyed");
    if (checkFinished && instance.finished)
      throw new Error("digest() was already called");
  }
  function aoutput(out, instance) {
    abytes(out, void 0, "output");
    const min = instance.outputLen;
    if (!(out.length >= min)) {
      throw new RangeError('"output" expected length >= ' + min);
    }
  }
  function u32(arr) {
    return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
  }
  function clean(...arrays) {
    for (let i = 0; i < arrays.length; i++) {
      arrays[i].fill(0);
    }
  }
  function createView(arr) {
    return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
  }
  function rotr(word, shift) {
    return word << 32 - shift | word >>> shift;
  }
  function rotl(word, shift) {
    return word << shift | word >>> 32 - shift >>> 0;
  }
  var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
  function byteSwap(word) {
    return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
  }
  function byteSwap32(arr) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = byteSwap(arr[i]);
    }
    return arr;
  }
  var swap32IfBE = isLE ? (u) => u : byteSwap32;
  function utf8ToBytes(str) {
    if (typeof str !== "string")
      throw new TypeError("string expected");
    const encoded = new TextEncoder().encode(str);
    try {
      return new Uint8Array(encoded);
    } finally {
      clean(encoded);
    }
  }
  function kdfInputToBytes(data, errorTitle = "") {
    if (typeof data === "string")
      return utf8ToBytes(data);
    return abytes(data, void 0, errorTitle);
  }
  function checkOpts(defaults, opts, title = "opts") {
    aopts(defaults, "defaults");
    if (opts !== void 0)
      aopts(opts, title);
    const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
    return merged;
  }
  function createHasher(hashCons, info = {}) {
    if (typeof hashCons !== "function")
      throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
    info = checkOpts({}, info, "info");
    const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
    const tmp = hashCons(void 0);
    hashC.outputLen = tmp.outputLen;
    hashC.blockLen = tmp.blockLen;
    hashC.canXOF = tmp.canXOF;
    hashC.create = (opts) => hashCons(opts);
    Object.assign(hashC, info);
    return Object.freeze(hashC);
  }
  var oidNist = (suffix) => ({
    // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
    // Larger suffix values would need base-128 OID encoding and a different length byte.
    oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
  });

  // node_modules/@noble/hashes/hmac.js
  var _HMAC = class {
    constructor(hash, key) {
      __publicField(this, "oHash");
      __publicField(this, "iHash");
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF", false);
      __publicField(this, "finished", false);
      __publicField(this, "destroyed", false);
      ahash(hash);
      abytes(key, void 0, "key");
      this.iHash = hash.create();
      if (typeof this.iHash.update !== "function")
        throw new Error("expected Hash instance");
      this.blockLen = this.iHash.blockLen;
      this.outputLen = this.iHash.outputLen;
      const blockLen = this.blockLen;
      const pad = new Uint8Array(blockLen);
      pad.set(key.length > blockLen ? hash.create().update(key).digest() : key);
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54;
      this.iHash.update(pad);
      this.oHash = hash.create();
      for (let i = 0; i < pad.length; i++)
        pad[i] ^= 54 ^ 92;
      this.oHash.update(pad);
      clean(pad);
    }
    update(buf) {
      aexists(this);
      this.iHash.update(buf);
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const buf = out.subarray(0, this.outputLen);
      this.iHash.digestInto(buf);
      this.oHash.update(buf);
      this.oHash.digestInto(buf);
      this.destroy();
    }
    digest() {
      const out = new Uint8Array(this.oHash.outputLen);
      this.digestInto(out);
      return out;
    }
    _cloneInto(to) {
      to || (to = Object.create(Object.getPrototypeOf(this), {}));
      const { oHash, iHash, finished, destroyed, blockLen, outputLen, canXOF } = this;
      to = to;
      to.finished = finished;
      to.destroyed = destroyed;
      to.blockLen = blockLen;
      to.outputLen = outputLen;
      to.canXOF = canXOF;
      to.oHash = oHash._cloneInto(to.oHash);
      to.iHash = iHash._cloneInto(to.iHash);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
    destroy() {
      this.destroyed = true;
      this.oHash.destroy();
      this.iHash.destroy();
    }
  };
  var hmac = /* @__PURE__ */ (() => {
    const hmac_ = ((hash, key, message) => new _HMAC(hash, key).update(message).digest());
    hmac_.create = (hash, key) => new _HMAC(hash, key);
    return hmac_;
  })();

  // node_modules/@noble/hashes/pbkdf2.js
  function pbkdf2Init(hash, _password, _salt, _opts) {
    ahash(hash);
    const opts = checkOpts({ dkLen: 32, asyncTick: 10 }, _opts);
    const { c, dkLen, asyncTick } = opts;
    anumber(c, "c");
    anumber(dkLen, "dkLen");
    anumber(asyncTick, "asyncTick");
    if (c < 1)
      throw new Error('"c" (iterations) must be >= 1');
    if (dkLen < 1)
      throw new Error('"dkLen" must be >= 1');
    if (dkLen > (2 ** 32 - 1) * hash.outputLen)
      throw new Error("derived key too long");
    const p = kdfInputToBytes(_password, "password");
    try {
      const s = kdfInputToBytes(_salt, "salt");
      try {
        const DK = new Uint8Array(dkLen);
        const { iHash, oHash, outputLen } = hmac.create(hash, p);
        const u = new Uint8Array(outputLen);
        const eng = pbkdf2Engine(iHash, oHash, s, u);
        return { c, dkLen, asyncTick, DK, outputLen, eng };
      } finally {
        if (typeof _salt === "string")
          clean(s);
      }
    } finally {
      if (typeof _password === "string")
        clean(p);
    }
  }
  function pbkdf2Engine(iHash, oHash, salt, u) {
    const counter = new Uint8Array(4);
    const view = createView(counter);
    const salted = iHash._cloneInto().update(salt);
    const work = oHash._cloneInto();
    const iClone = iHash._cloneInto;
    const oClone = oHash._cloneInto;
    return {
      u1: (ti, Ti) => {
        view.setInt32(0, ti, false);
        salted._cloneInto(work).update(counter).digestInto(u);
        oHash._cloneInto(work).update(u).digestInto(u);
        Ti.set(u.subarray(0, Ti.length));
      },
      // Whole `F` inner loop for the sync variant: one optimized function owns the hot loop.
      rounds: (c, Ti) => {
        for (let ui = 1; ui < c; ui++) {
          iClone.call(iHash, work).update(u).digestInto(u);
          oClone.call(oHash, work).update(u).digestInto(u);
          for (let i = 0; i < Ti.length; i++)
            Ti[i] ^= u[i];
        }
      },
      output: (DK) => {
        iHash.destroy();
        oHash.destroy();
        salted.destroy();
        work.destroy();
        clean(u);
        return DK;
      }
    };
  }
  function pbkdf2(hash, password, salt, opts) {
    const { c, dkLen, DK, outputLen, eng } = pbkdf2Init(hash, password, salt, opts);
    for (let ti = 1, pos = 0; pos < dkLen; ti++, pos += outputLen) {
      const Ti = DK.subarray(pos, pos + outputLen);
      eng.u1(ti, Ti);
      eng.rounds(c, Ti);
    }
    return eng.output(DK);
  }

  // node_modules/@noble/hashes/_u64.js
  var fromNumH = (n) => n / 2 ** 32 | 0;
  var fromNumL = (n) => n >>> 0;
  function setU64FromNum(view, byteOffset, n, isLE2) {
    const h = fromNumH(n);
    const l = fromNumL(n);
    view.setUint32(byteOffset, isLE2 ? l : h, isLE2);
    view.setUint32(byteOffset + 4, isLE2 ? h : l, isLE2);
  }

  // node_modules/@noble/hashes/_md.js
  function Chi(a, b, c) {
    return a & b ^ ~a & c;
  }
  function Maj(a, b, c) {
    return a & b ^ a & c ^ b & c;
  }
  var HashMD = class {
    constructor(blockLen, outputLen, padOffset, isLE2) {
      __publicField(this, "blockLen");
      __publicField(this, "outputLen");
      __publicField(this, "canXOF", false);
      __publicField(this, "padOffset");
      __publicField(this, "isLE");
      // For partial updates less than block size
      __publicField(this, "buffer");
      __publicField(this, "view");
      __publicField(this, "finished", false);
      __publicField(this, "length", 0);
      __publicField(this, "pos", 0);
      __publicField(this, "destroyed", false);
      this.blockLen = blockLen;
      this.outputLen = outputLen;
      this.padOffset = padOffset;
      this.isLE = isLE2;
      this.buffer = new Uint8Array(blockLen);
      this.view = createView(this.buffer);
    }
    update(data) {
      aexists(this);
      abytes(data);
      const { view, buffer, blockLen } = this;
      const len = data.length;
      let processed = false;
      for (let pos = 0; pos < len; ) {
        const take = Math.min(blockLen - this.pos, len - pos);
        if (take === blockLen) {
          const dataView = createView(data);
          for (; blockLen <= len - pos; pos += blockLen)
            this.process(dataView, pos);
          processed = true;
          continue;
        }
        buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
        this.pos += take;
        pos += take;
        if (this.pos === blockLen) {
          this.process(view, 0);
          this.pos = 0;
          processed = true;
        }
      }
      this.length += data.length;
      if (processed)
        this.roundClean();
      return this;
    }
    digestInto(out) {
      aexists(this);
      aoutput(out, this);
      this.finished = true;
      const { buffer, view, blockLen, isLE: isLE2 } = this;
      let { pos } = this;
      buffer[pos++] = 128;
      buffer.fill(0, pos);
      if (this.padOffset > blockLen - pos) {
        this.process(view, 0);
        buffer.fill(0);
      }
      setU64FromNum(view, blockLen - 8, this.length * 8, isLE2);
      this.process(view, 0);
      this.roundClean();
      const oview = out === buffer ? view : createView(out);
      const len = this.outputLen;
      const outLen = len / 4;
      const state = this.get();
      if (len % 4 || outLen > state.length)
        throw new Error("invalid outputLen");
      for (let i = 0; i < outLen; i++)
        oview.setUint32(4 * i, state[i], isLE2);
    }
    digest() {
      const { buffer, outputLen } = this;
      this.digestInto(buffer);
      const res = buffer.slice(0, outputLen);
      this.destroy();
      return res;
    }
    _cloneIntoMeta(to) {
      const { buffer, length, finished, destroyed, pos } = this;
      to.destroyed = destroyed;
      to.finished = finished;
      to.length = length;
      to.pos = pos;
      if (pos)
        to.buffer.set(buffer);
      return to;
    }
    clone() {
      return this._cloneInto();
    }
  };
  var SHA256_IV = /* @__PURE__ */ Uint32Array.from([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);

  // node_modules/@noble/hashes/sha2.js
  var SHA256_K = /* @__PURE__ */ Uint32Array.from([
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ]);
  var SHA256_W = /* @__PURE__ */ new Uint32Array(64);
  var SHA2_32B = class extends HashMD {
    constructor(outputLen, IV) {
      super(64, outputLen, 8, false);
      // We cannot use array here since array allows indexing by variable
      // which means optimizer/compiler cannot use registers.
      // Numeric initializers matter: starting the fields as `undefined` changes
      // V8's field representation and makes sha256 3x slower (measured).
      __publicField(this, "A", 0);
      __publicField(this, "B", 0);
      __publicField(this, "C", 0);
      __publicField(this, "D", 0);
      __publicField(this, "E", 0);
      __publicField(this, "F", 0);
      __publicField(this, "G", 0);
      __publicField(this, "H", 0);
      this.A = IV[0] | 0;
      this.B = IV[1] | 0;
      this.C = IV[2] | 0;
      this.D = IV[3] | 0;
      this.E = IV[4] | 0;
      this.F = IV[5] | 0;
      this.G = IV[6] | 0;
      this.H = IV[7] | 0;
    }
    get() {
      const { A, B, C, D, E, F, G, H } = this;
      return [A, B, C, D, E, F, G, H];
    }
    // prettier-ignore
    set(A, B, C, D, E, F, G, H) {
      this.A = A | 0;
      this.B = B | 0;
      this.C = C | 0;
      this.D = D | 0;
      this.E = E | 0;
      this.F = F | 0;
      this.G = G | 0;
      this.H = H | 0;
    }
    _cloneInto(to) {
      (to || (to = new this.constructor())).set(...this.get());
      return this._cloneIntoMeta(to);
    }
    process(view, offset) {
      for (let i = 0; i < 16; i++, offset += 4)
        SHA256_W[i] = view.getUint32(offset, false);
      for (let i = 16; i < 64; i++) {
        const W15 = SHA256_W[i - 15];
        const W2 = SHA256_W[i - 2];
        const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
        const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
        SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
      }
      let { A, B, C, D, E, F, G, H } = this;
      for (let i = 0; i < 64; i++) {
        const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
        const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
        const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
        const T2 = sigma0 + Maj(A, B, C) | 0;
        H = G;
        G = F;
        F = E;
        E = D + T1 | 0;
        D = C;
        C = B;
        B = A;
        A = T1 + T2 | 0;
      }
      A = A + this.A | 0;
      B = B + this.B | 0;
      C = C + this.C | 0;
      D = D + this.D | 0;
      E = E + this.E | 0;
      F = F + this.F | 0;
      G = G + this.G | 0;
      H = H + this.H | 0;
      this.set(A, B, C, D, E, F, G, H);
    }
    roundClean() {
      clean(SHA256_W);
    }
    destroy() {
      this.destroyed = true;
      this.set(0, 0, 0, 0, 0, 0, 0, 0);
      clean(this.buffer);
    }
  };
  var _SHA256 = class extends SHA2_32B {
    constructor() {
      super(32, SHA256_IV);
    }
  };
  var sha256 = /* @__PURE__ */ createHasher(
    () => new _SHA256(),
    /* @__PURE__ */ oidNist(1)
  );

  // node_modules/@noble/hashes/scrypt.js
  function XorAndSalsa(prev, pi, input, ii, out, oi) {
    let y00 = prev[pi++] ^ input[ii++], y01 = prev[pi++] ^ input[ii++];
    let y02 = prev[pi++] ^ input[ii++], y03 = prev[pi++] ^ input[ii++];
    let y04 = prev[pi++] ^ input[ii++], y05 = prev[pi++] ^ input[ii++];
    let y06 = prev[pi++] ^ input[ii++], y07 = prev[pi++] ^ input[ii++];
    let y08 = prev[pi++] ^ input[ii++], y09 = prev[pi++] ^ input[ii++];
    let y10 = prev[pi++] ^ input[ii++], y11 = prev[pi++] ^ input[ii++];
    let y12 = prev[pi++] ^ input[ii++], y13 = prev[pi++] ^ input[ii++];
    let y14 = prev[pi++] ^ input[ii++], y15 = prev[pi++] ^ input[ii++];
    let x00 = y00, x01 = y01, x02 = y02, x03 = y03, x04 = y04, x05 = y05, x06 = y06, x07 = y07, x08 = y08, x09 = y09, x10 = y10, x11 = y11, x12 = y12, x13 = y13, x14 = y14, x15 = y15;
    for (let i = 0; i < 8; i += 2) {
      x04 ^= rotl(x00 + x12 | 0, 7);
      x08 ^= rotl(x04 + x00 | 0, 9);
      x12 ^= rotl(x08 + x04 | 0, 13);
      x00 ^= rotl(x12 + x08 | 0, 18);
      x09 ^= rotl(x05 + x01 | 0, 7);
      x13 ^= rotl(x09 + x05 | 0, 9);
      x01 ^= rotl(x13 + x09 | 0, 13);
      x05 ^= rotl(x01 + x13 | 0, 18);
      x14 ^= rotl(x10 + x06 | 0, 7);
      x02 ^= rotl(x14 + x10 | 0, 9);
      x06 ^= rotl(x02 + x14 | 0, 13);
      x10 ^= rotl(x06 + x02 | 0, 18);
      x03 ^= rotl(x15 + x11 | 0, 7);
      x07 ^= rotl(x03 + x15 | 0, 9);
      x11 ^= rotl(x07 + x03 | 0, 13);
      x15 ^= rotl(x11 + x07 | 0, 18);
      x01 ^= rotl(x00 + x03 | 0, 7);
      x02 ^= rotl(x01 + x00 | 0, 9);
      x03 ^= rotl(x02 + x01 | 0, 13);
      x00 ^= rotl(x03 + x02 | 0, 18);
      x06 ^= rotl(x05 + x04 | 0, 7);
      x07 ^= rotl(x06 + x05 | 0, 9);
      x04 ^= rotl(x07 + x06 | 0, 13);
      x05 ^= rotl(x04 + x07 | 0, 18);
      x11 ^= rotl(x10 + x09 | 0, 7);
      x08 ^= rotl(x11 + x10 | 0, 9);
      x09 ^= rotl(x08 + x11 | 0, 13);
      x10 ^= rotl(x09 + x08 | 0, 18);
      x12 ^= rotl(x15 + x14 | 0, 7);
      x13 ^= rotl(x12 + x15 | 0, 9);
      x14 ^= rotl(x13 + x12 | 0, 13);
      x15 ^= rotl(x14 + x13 | 0, 18);
    }
    out[oi++] = y00 + x00 | 0;
    out[oi++] = y01 + x01 | 0;
    out[oi++] = y02 + x02 | 0;
    out[oi++] = y03 + x03 | 0;
    out[oi++] = y04 + x04 | 0;
    out[oi++] = y05 + x05 | 0;
    out[oi++] = y06 + x06 | 0;
    out[oi++] = y07 + x07 | 0;
    out[oi++] = y08 + x08 | 0;
    out[oi++] = y09 + x09 | 0;
    out[oi++] = y10 + x10 | 0;
    out[oi++] = y11 + x11 | 0;
    out[oi++] = y12 + x12 | 0;
    out[oi++] = y13 + x13 | 0;
    out[oi++] = y14 + x14 | 0;
    out[oi++] = y15 + x15 | 0;
  }
  function BlockMix(input, ii, out, oi, r) {
    let head = oi + 0;
    let tail = oi + 16 * r;
    for (let i = 0; i < 16; i++)
      out[tail + i] = input[ii + (2 * r - 1) * 16 + i];
    for (let i = 0; i < r; i++, head += 16, ii += 16) {
      XorAndSalsa(out, tail, input, ii, out, head);
      if (i > 0)
        tail += 16;
      XorAndSalsa(out, head, input, ii += 16, out, tail);
    }
  }
  var SCRYPT_DEFAULT_MAXMEM = 128 * 8 * (2 ** 20 + 1 + 1);
  function scryptInit(password, salt, _opts) {
    const opts = checkOpts({
      dkLen: 32,
      asyncTick: 10,
      maxmem: SCRYPT_DEFAULT_MAXMEM
    }, _opts);
    const { N, r, p, dkLen, asyncTick, maxmem, onProgress } = opts;
    anumber(N, "N");
    anumber(r, "r");
    anumber(p, "p");
    anumber(dkLen, "dkLen");
    anumber(asyncTick, "asyncTick");
    anumber(maxmem, "maxmem");
    if (onProgress !== void 0 && typeof onProgress !== "function")
      throw new Error('"onProgress" must be a function');
    if (r < 1)
      throw new Error('"r" expected integer >= 1');
    const blockSize = 128 * r;
    const blockSize32 = blockSize / 4;
    const pow32 = Math.pow(2, 32);
    if (N <= 1 || (N & N - 1) !== 0 || N > pow32)
      throw new Error('"N" expected a power of 2, and 2^1 <= N <= 2^32');
    if (p < 1 || p > (pow32 - 1) * 32 / blockSize)
      throw new Error('"p" expected integer 1..((2^32 - 1) * 32) / (128 * r)');
    if (dkLen < 1 || dkLen > (pow32 - 1) * 32)
      throw new Error('"dkLen" expected integer 1..(2^32 - 1) * 32');
    const memUsed = blockSize * (N + p + 1);
    if (memUsed > maxmem)
      throw new Error('"maxmem" limit was hit: memUsed(128*r*(N+p+1))=' + memUsed + ", maxmem=" + maxmem);
    const B = pbkdf2(sha256, password, salt, { c: 1, dkLen: blockSize * p });
    const B32 = u32(B);
    const V = u32(new Uint8Array(blockSize * N));
    const tmp = u32(new Uint8Array(blockSize));
    let blockMixCb = () => {
    };
    if (onProgress) {
      const totalBlockMix = 2 * N * p;
      const callbackPer = Math.max(Math.floor(totalBlockMix / 1e4), 1);
      let blockMixCnt = 0;
      blockMixCb = () => {
        blockMixCnt++;
        if (onProgress && (!(blockMixCnt % callbackPer) || blockMixCnt === totalBlockMix)) {
          try {
            onProgress(blockMixCnt / totalBlockMix);
          } catch (e) {
            clean(B, V, tmp);
            throw e;
          }
        }
      };
    }
    return { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb, asyncTick };
  }
  function scryptOutput(password, dkLen, B, V, tmp) {
    const res = pbkdf2(sha256, password, B, { c: 1, dkLen });
    clean(B, V, tmp);
    return res;
  }
  function scrypt(password, salt, opts) {
    const { N, r, p, dkLen, blockSize32, V, B32, B, tmp, blockMixCb } = scryptInit(password, salt, opts);
    swap32IfBE(B32);
    for (let pi = 0; pi < p; pi++) {
      const Pi = blockSize32 * pi;
      for (let i = 0; i < blockSize32; i++)
        V[i] = B32[Pi + i];
      for (let i = 0, pos = 0; i < N - 1; i++) {
        BlockMix(V, pos, V, pos += blockSize32, r);
        blockMixCb();
      }
      BlockMix(V, (N - 1) * blockSize32, B32, Pi, r);
      blockMixCb();
      for (let i = 0; i < N; i++) {
        const j = (B32[Pi + blockSize32 - 16] & N - 1) >>> 0;
        for (let k = 0; k < blockSize32; k++)
          tmp[k] = B32[Pi + k] ^ V[j * blockSize32 + k];
        BlockMix(tmp, 0, B32, Pi, r);
        blockMixCb();
      }
    }
    swap32IfBE(B32);
    return scryptOutput(password, dkLen, B, V, tmp);
  }

  // google/src/security.ts
  function constantEqual(a, b) {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }
  function verifyPasswordBytes(password, saltBytes, encoded) {
    const [kind, salt, hex2] = encoded.split(":");
    if (kind !== "scrypt" || !salt || !hex2) return false;
    const actual = scrypt(password, saltBytes(salt), {
      N: 16384,
      r: 8,
      p: 1,
      dkLen: 64
    });
    return constantEqual(
      Array.from(actual, (b) => b.toString(16).padStart(2, "0")).join(""),
      hex2
    );
  }
  function validateWebp(bytes) {
    if (bytes.length < 30 || bytes.length > 3 * 1024 * 1024)
      throw new Error("Invalid image size");
    const str = (i, n) => String.fromCharCode(...bytes.slice(i, i + n));
    const u322 = (i) => (bytes[i] | bytes[i + 1] << 8 | bytes[i + 2] << 16 | bytes[i + 3] << 24) >>> 0;
    if (str(0, 4) !== "RIFF" || str(8, 4) !== "WEBP" || u322(4) + 8 !== bytes.length)
      throw new Error("Invalid WebP");
    let width = 0, height = 0;
    for (let offset = 12; offset + 8 <= bytes.length; ) {
      const tag = str(offset, 4), length = u322(offset + 4), start = offset + 8;
      if (start + length > bytes.length) throw new Error("Truncated image");
      if (tag === "ANIM" || tag === "ANMF")
        throw new Error("Animated images not allowed");
      if (tag === "VP8 " && length >= 10 && str(start + 3, 3) === "\x9D*") {
        width = (bytes[start + 6] | bytes[start + 7] << 8) & 16383;
        height = (bytes[start + 8] | bytes[start + 9] << 8) & 16383;
      }
      if (tag === "VP8L" && length >= 5 && bytes[start] === 47) {
        const bits = u322(start + 1);
        width = (bits & 16383) + 1;
        height = (bits >>> 14 & 16383) + 1;
      }
      offset = start + length + length % 2;
    }
    if (width < 1 || height < 1 || width > 1600 || height > 1600)
      throw new Error("Invalid dimensions");
    return { width, height };
  }
  function hashPasswordBytes(password, salt, saltBytes) {
    const hash = scrypt(password, saltBytes(salt), {
      N: 16384,
      r: 8,
      p: 1,
      dkLen: 64
    });
    return `scrypt:${salt}:${Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }

  // google/src/schema.ts
  var schema = {
    stations: ["id", "name"],
    users: [
      "id",
      "name",
      "login",
      "password_hash",
      "role",
      "active_station_id",
      "deleted_at"
    ],
    station_tasks: [
      "id",
      "station_id",
      "title",
      "task_type",
      "sort_order",
      "is_active",
      "created_work_date",
      "inactive_work_date"
    ],
    station_task_completions: [
      "id",
      "task_id",
      "work_date",
      "photo_path",
      "completed_at",
      "completed_by_user_id"
    ],
    refrigerators: ["id", "number", "station_id"],
    refrigerator_tasks: ["id", "refrigerator_id", "title", "sort_order"],
    refrigerator_task_completions: [
      "id",
      "task_id",
      "work_date",
      "photo_path",
      "completed_at",
      "completed_by_user_id"
    ],
    additional_task_types: ["id", "title", "is_active"],
    additional_tasks: [
      "id",
      "task_type_id",
      "work_date",
      "photo_path",
      "completed_at",
      "completed_by_user_id",
      "title_snapshot"
    ],
    additional_task_assignees: ["additional_task_id", "user_id"],
    daily_statistics: ["work_date", "completed_tasks", "total_tasks"],
    daily_station_statistics: [
      "work_date",
      "station_id",
      "completed_tasks",
      "total_tasks"
    ],
    sessions: ["token_hash", "user_id", "expires_at"],
    login_attempts: ["key", "attempts", "reset_at"],
    operations: ["id", "fingerprint", "response", "expires_at"]
  };
  var tableNames = Object.keys(schema);
  function emptyTables() {
    return Object.fromEntries(
      tableNames.map((k) => [k, []])
    );
  }

  // google/src/migration.ts
  var legacyColumns = {
    users: ["id", "name", "login", "password_hash", "role", "active_station_id"],
    station_task_completions: [
      "id",
      "task_id",
      "work_date",
      "photo_path",
      "completed_at"
    ],
    refrigerator_task_completions: [
      "id",
      "task_id",
      "work_date",
      "photo_path",
      "completed_at"
    ],
    additional_tasks: [
      "id",
      "task_type_id",
      "work_date",
      "photo_path",
      "completed_at"
    ],
    additional_task_types: ["id", "title"]
  };
  function migrateValues(values) {
    const db = emptyTables();
    const changed = [];
    for (const [index, table] of tableNames.entries()) {
      const rows = values[index];
      const headers = rows?.[0];
      const current2 = schema[table];
      const legacy = legacyColumns[table];
      const same = JSON.stringify(headers) === JSON.stringify(current2);
      if (!same && (!legacy || JSON.stringify(headers) !== JSON.stringify(legacy)))
        throw new Error("Unrecognized schema; no data changed: " + table);
      if (!same) changed.push(table);
      for (const row of rows.slice(1).filter((r) => r.some((v) => v !== "" && v !== null))) {
        const record = Object.fromEntries(
          current2.map((key) => {
            const pos = headers.indexOf(key);
            const value = pos < 0 ? key === "is_active" ? true : null : row[pos];
            return [key, value === void 0 || value === "" ? null : value];
          })
        );
        db[table].push(record);
      }
    }
    if (changed.includes("additional_tasks")) {
      const titles = new Map(
        db.additional_task_types.map((t) => [t.id, t.title])
      );
      for (const task of db.additional_tasks)
        task.title_snapshot = titles.get(task.task_type_id) ?? null;
    }
    return { db, changed };
  }

  // google/src/sheets.ts
  function spreadsheetId() {
    const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (!id) throw new Error("SPREADSHEET_ID missing");
    return id;
  }
  function api() {
    if (!Sheets?.Spreadsheets) throw new Error("Enable advanced Sheets service");
    return Sheets.Spreadsheets;
  }
  function readDatabase(selected = tableNames) {
    const db = emptyTables();
    const result = api().Values.batchGet(spreadsheetId(), {
      ranges: selected.map((k) => `'${k}'!A:Z`),
      valueRenderOption: "UNFORMATTED_VALUE"
    });
    for (const [index, table] of selected.entries()) {
      const values = result.valueRanges?.[index]?.values ?? [];
      const headers = schema[table];
      if (JSON.stringify(values[0]) !== JSON.stringify(headers))
        throw new Error(`Invalid sheet schema: ${table}`);
      const rows = values.slice(1).filter((row) => row.some((v) => v !== "" && v !== null)).map(
        (row) => Object.fromEntries(
          headers.map((key, i) => [
            key,
            row[i] === void 0 || row[i] === "" ? null : row[i]
          ])
        )
      );
      db[table].push(...rows);
    }
    return db;
  }
  function commitDatabase(before, after, force = []) {
    const changed = tableNames.filter(
      (k) => force.includes(k) || JSON.stringify(before[k]) !== JSON.stringify(after[k])
    );
    if (!changed.length) return;
    const metadata = api().get(spreadsheetId(), { fields: "sheets.properties" });
    const requests = [];
    for (const table of changed) {
      const props = metadata.sheets?.find(
        (s) => s.properties?.title === table
      )?.properties;
      if (props?.sheetId === void 0) throw new Error("Missing sheet");
      const headers = schema[table];
      const rows = [
        headers,
        ...after[table].map(
          (row) => headers.map((key) => row[key])
        )
      ];
      const count = Math.max(before[table].length + 1, rows.length);
      if ((props.gridProperties?.rowCount ?? 0) < count)
        requests.push({
          appendDimension: {
            sheetId: props.sheetId,
            dimension: "ROWS",
            length: count - (props.gridProperties?.rowCount ?? 0)
          }
        });
      requests.push({
        updateCells: {
          range: {
            sheetId: props.sheetId,
            startRowIndex: 0,
            endRowIndex: count,
            startColumnIndex: 0,
            endColumnIndex: headers.length
          },
          rows: rows.map((row) => ({
            values: row.map((value) => ({
              userEnteredValue: typeof value === "number" ? { numberValue: value } : typeof value === "boolean" ? { boolValue: value } : value === null || value === void 0 ? {} : { stringValue: String(value) }
            }))
          })),
          fields: "userEnteredValue"
        }
      });
    }
    api().batchUpdate({ requests }, spreadsheetId());
  }
  function ensureSheets() {
    const ss = SpreadsheetApp.openById(spreadsheetId());
    ss.setSpreadsheetTimeZone("Europe/Moscow");
    for (const name of tableNames) {
      let sheet = ss.getSheetByName(name);
      const headers = schema[name];
      if (!sheet) sheet = ss.insertSheet(name);
      if (sheet.getLastRow() === 0) {
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        sheet.setFrozenRows(1);
      } else {
        const actual = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        if (JSON.stringify(actual) !== JSON.stringify(headers) && JSON.stringify(actual) !== JSON.stringify(legacyColumns[name]))
          throw new Error("Existing headers differ: " + name);
      }
    }
    SpreadsheetApp.flush();
  }
  function migrateSheets() {
    const result = api().Values.batchGet(spreadsheetId(), {
      ranges: tableNames.map((k) => `'${k}'!A:Z`),
      valueRenderOption: "UNFORMATTED_VALUE"
    });
    const { db, changed } = migrateValues(
      tableNames.map((_, i) => result.valueRanges?.[i]?.values ?? [])
    );
    commitDatabase(db, db, changed);
  }

  // google/src/main.ts
  var prop = (name) => {
    const value = PropertiesService.getScriptProperties().getProperty(name);
    if (!value) throw new Error("Missing configuration: " + name);
    return value;
  };
  var hex = (bytes) => bytes.map((b) => (b & 255).toString(16).padStart(2, "0")).join("");
  var utf8 = (value) => new Uint8Array(
    Utilities.newBlob(value).getBytes().map((b) => b & 255)
  );
  function deps(created) {
    return {
      readOnly: migrationReadOnly(),
      now: () => /* @__PURE__ */ new Date(),
      uuid: () => Utilities.getUuid(),
      hash: (value) => hex(
        Utilities.computeDigest(
          Utilities.DigestAlgorithm.SHA_256,
          value,
          Utilities.Charset.UTF_8
        )
      ),
      verify: (password, encoded) => verifyPasswordBytes(utf8(password), utf8, encoded),
      hashPassword: (password) => hashPasswordBytes(
        utf8(password),
        Utilities.getUuid().replace(/-/g, ""),
        utf8
      ),
      credentialFingerprint: (password) => hex(
        Utilities.computeHmacSha256Signature(
          password,
          prop("GOOGLE_API_SECRET"),
          Utilities.Charset.UTF_8
        )
      ),
      bootstrapEnabled: PropertiesService.getScriptProperties().getProperty(
        "BOOTSTRAP_ENABLED"
      ) === "true",
      savePhoto: (base64, name) => {
        let bytes;
        try {
          bytes = Utilities.base64Decode(base64);
          validateWebp(new Uint8Array(bytes.map((b) => b & 255)));
        } catch {
          throw new BackendError(
            "INVALID_PHOTO",
            "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u0430\u044F \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u044F WebP."
          );
        }
        const folder = DriveApp.getFolderById(prop("PHOTO_FOLDER_ID"));
        if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE)
          throw new BackendError(
            "STORAGE_CONFIG",
            "\u041F\u0430\u043F\u043A\u0430 \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u0439 \u0434\u043E\u043B\u0436\u043D\u0430 \u0431\u044B\u0442\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u043E\u0439.",
            503
          );
        const file = folder.createFile(
          Utilities.newBlob(bytes, "image/webp", name)
        );
        created.push(file.getId());
        if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
          file.setTrashed(true);
          throw new BackendError(
            "STORAGE_CONFIG",
            "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0437\u0430\u043A\u0440\u044B\u0442\u0443\u044E \u0444\u043E\u0442\u043E\u0433\u0440\u0430\u0444\u0438\u044E.",
            503
          );
        }
        return file.getId();
      },
      getPhoto: (id) => {
        const file = DriveApp.getFileById(id);
        if (file.isTrashed())
          throw new BackendError("NOT_FOUND", "\u0424\u043E\u0442\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", 404);
        const blob = file.getBlob();
        return {
          base64: Utilities.base64Encode(blob.getBytes()),
          mimeType: "image/webp"
        };
      },
      trashPhoto: (id) => {
        try {
          DriveApp.getFileById(id).setTrashed(true);
        } catch {
          console.error("Orphan photo cleanup failed: " + id);
        }
      }
    };
  }
  function scriptProperties() {
    return PropertiesService.getScriptProperties();
  }
  function migrationReadOnly() {
    return scriptProperties().getProperty("GOOGLE_READ_ONLY") === "true";
  }
  function assertWritable() {
    if (migrationReadOnly())
      throw new BackendError(
        "MIGRATION_READ_ONLY",
        "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u0432\u0440\u0435\u043C\u0435\u043D\u043D\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0430 \u0434\u043B\u044F \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0430 \u0434\u0430\u043D\u043D\u044B\u0445. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u0437\u0436\u0435.",
        503
      );
  }
  function requireMysqlBridge() {
    if (scriptProperties().getProperty("MYSQL_BRIDGE_ENABLED") !== "true")
      throw new BackendError("FORBIDDEN", "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
  }
  function mysqlBridge(action, data) {
    requireMysqlBridge();
    if (action === "bridgeVerify") {
      const password = data.password;
      const encoded = data.encoded;
      if (typeof password !== "string" || password.length < 1 || password.length > 128 || typeof encoded !== "string" || !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded))
        throw new BackendError("INVALID_INPUT", "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0435 \u0434\u0430\u043D\u043D\u044B\u0435 \u043F\u0430\u0440\u043E\u043B\u044F.");
      return { valid: verifyPasswordBytes(utf8(password), utf8, encoded) };
    }
    if (action === "bridgePhoto") {
      const fileId = data.fileId;
      if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
        throw new BackendError("NOT_FOUND", "\u0424\u043E\u0442\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", 404);
      try {
        const file = DriveApp.getFileById(fileId);
        if (file.isTrashed() || file.getMimeType() !== "image/webp")
          throw new Error("Unavailable file");
        const expectedFolder = prop("PHOTO_FOLDER_ID");
        const parents = file.getParents();
        let expectedParent = false;
        while (parents.hasNext()) {
          if (parents.next().getId() === expectedFolder) expectedParent = true;
        }
        if (!expectedParent || file.getSharingAccess() !== DriveApp.Access.PRIVATE)
          throw new Error("File is outside private storage");
        const bytes = file.getBlob().getBytes();
        validateWebp(new Uint8Array(bytes.map((b) => b & 255)));
        return {
          base64: Utilities.base64Encode(bytes),
          mimeType: "image/webp"
        };
      } catch {
        throw new BackendError("NOT_FOUND", "\u0424\u043E\u0442\u043E \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D\u043E.", 404);
      }
    }
    throw new BackendError("NOT_FOUND", "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 API.", 404);
  }
  function doGet() {
    return json({ success: true, data: { service: "ESCAPE API" }, error: null });
  }
  function json(result) {
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
      ContentService.MimeType.JSON
    );
  }
  function doPost(e) {
    let lock;
    const created = [];
    let committed = false;
    let commitAttempted = false;
    try {
      if (!e.postData?.contents || e.postData.contents.length > 18 * 1024 * 1024)
        throw new BackendError("INVALID_REQUEST", "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441.");
      const envelope = JSON.parse(e.postData.contents);
      if (typeof envelope.payload !== "string" || typeof envelope.signature !== "string")
        throw new BackendError("FORBIDDEN", "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
      const secret = prop("GOOGLE_API_SECRET");
      if (secret.length < 32) throw new Error("Secret too short");
      const expected = hex(
        Utilities.computeHmacSha256Signature(
          envelope.payload,
          secret,
          Utilities.Charset.UTF_8
        )
      );
      if (!constantEqual(expected, envelope.signature))
        throw new BackendError("FORBIDDEN", "\u041D\u0435\u0434\u043E\u0441\u0442\u0430\u0442\u043E\u0447\u043D\u043E \u043F\u0440\u0430\u0432.", 403);
      const request = JSON.parse(envelope.payload);
      if (!Number.isFinite(request.timestamp) || Math.abs(Date.now() - request.timestamp) > 3e5 || typeof request.action !== "string" || !request.data || typeof request.data !== "object")
        throw new BackendError(
          "INVALID_REQUEST",
          "\u0417\u0430\u043F\u0440\u043E\u0441 \u0443\u0441\u0442\u0430\u0440\u0435\u043B \u0438\u043B\u0438 \u0438\u043C\u0435\u0435\u0442 \u043D\u0435\u0432\u0435\u0440\u043D\u044B\u0439 \u0444\u043E\u0440\u043C\u0430\u0442."
        );
      if (request.action === "bridgeVerify" || request.action === "bridgePhoto")
        return json({
          success: true,
          data: mysqlBridge(request.action, request.data),
          error: null
        });
      if (writeActions.includes(request.action) || request.action === "getStatistics") {
        lock = LockService.getScriptLock();
        if (!lock.tryLock(25e3))
          throw new BackendError(
            "BUSY",
            "\u0421\u0438\u0441\u0442\u0435\u043C\u0430 \u0437\u0430\u043D\u044F\u0442\u0430. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0437\u0430\u043F\u0440\u043E\u0441.",
            503
          );
        if (writeActions.includes(request.action)) assertWritable();
      }
      const database = readDatabase(
        request.action === "getCurrentUser" ? ["users", "sessions"] : request.action === "getActivity" ? [
          "users",
          "sessions",
          "station_task_completions",
          "refrigerator_task_completions",
          "additional_tasks"
        ] : void 0
      );
      const before = JSON.parse(JSON.stringify(database));
      const services = deps(created);
      const result = execute(database, services, request);
      commitAttempted = true;
      commitDatabase(before, database);
      committed = true;
      if (request.action === "bootstrap" && result.success) {
        PropertiesService.getScriptProperties().deleteProperty(
          "BOOTSTRAP_ENABLED"
        );
      }
      return json(result);
    } catch (error) {
      if (!committed && created.length) {
        if (!commitAttempted) {
          created.forEach((id) => deps([]).trashPhoto(id));
        } else {
          try {
            const actual = readDatabase();
            const retained = new Set(
              [
                ...actual.station_task_completions,
                ...actual.refrigerator_task_completions,
                ...actual.additional_tasks
              ].flatMap((c) => photoPaths(c.photo_path))
            );
            created.filter((id) => !retained.has(id)).forEach((id) => deps([]).trashPhoto(id));
          } catch {
            console.error(
              "Uncertain photo commit; retained files for recovery: " + created.join(",")
            );
          }
        }
      }
      if (error instanceof BackendError)
        return json({
          success: false,
          data: null,
          error: {
            code: error.code,
            message: error.message,
            status: error.status
          }
        });
      console.error(
        "Google backend failure: " + (error instanceof Error ? error.name : "UnknownError")
      );
      return json({
        success: false,
        data: null,
        error: {
          code: "BACKEND_ERROR",
          message: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437.",
          status: 503
        }
      });
    } finally {
      lock?.releaseLock();
    }
  }
  function setupDatabase() {
    const lock = LockService.getScriptLock();
    lock.waitLock(25e3);
    try {
      assertWritable();
      ensureSheets();
      migrateSheets();
      const db = readDatabase();
      const before = JSON.parse(JSON.stringify(db));
      seed(db, deps([]));
      commitDatabase(before, db);
    } finally {
      lock.releaseLock();
    }
  }
  function snapshotPreviousDay() {
    const lock = LockService.getScriptLock();
    lock.waitLock(25e3);
    try {
      assertWritable();
      const db = readDatabase(), before = JSON.parse(JSON.stringify(db));
      const result = execute(db, deps([]), {
        action: "snapshot",
        data: {},
        requestId: Utilities.getUuid()
      });
      if (!result.success) throw new Error(result.error.message);
      commitDatabase(before, db);
    } finally {
      lock.releaseLock();
    }
  }
  function prepareMysqlMigrationExport() {
    const lock = LockService.getScriptLock();
    lock.waitLock(25e3);
    try {
      const properties = scriptProperties();
      const previousId = properties.getProperty("MIGRATION_EXPORT_FILE_ID");
      if (migrationReadOnly()) {
        if (!previousId)
          throw new Error(
            "Google is read-only but the migration export is missing"
          );
        const previous = DriveApp.getFileById(previousId);
        console.log("\u0413\u043E\u0442\u043E\u0432\u0430\u044F \u0432\u044B\u0433\u0440\u0443\u0437\u043A\u0430: " + previous.getUrl());
        return previous.getUrl();
      }
      const tables = readDatabase();
      tables.sessions = [];
      tables.login_attempts = [];
      tables.operations = [];
      const exportedAt = (/* @__PURE__ */ new Date()).toISOString();
      const source = {
        format: "escape-mysql-v1",
        exportedAt,
        frozen: true,
        tables: Object.fromEntries(
          tableNames.map((name2) => [name2, tables[name2]])
        )
      };
      const sourceJson = JSON.stringify(source);
      const sourceSha256 = hex(
        Utilities.computeDigest(
          Utilities.DigestAlgorithm.SHA_256,
          sourceJson,
          Utilities.Charset.UTF_8
        )
      );
      const document = JSON.stringify({ ...source, sourceSha256 });
      const name = "escape-mysql-migration-" + exportedAt.replace(/[:.]/g, "-") + ".json";
      const file = DriveApp.createFile(
        Utilities.newBlob(document, "application/json", name)
      );
      if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
        file.setTrashed(true);
        throw new Error("Migration export must be private");
      }
      try {
        properties.setProperties(
          {
            GOOGLE_READ_ONLY: "true",
            MIGRATION_EXPORT_FILE_ID: file.getId(),
            MIGRATION_EXPORT_SHA256: sourceSha256
          },
          false
        );
      } catch (error) {
        file.setTrashed(true);
        throw error;
      }
      console.log(
        "\u0412\u044B\u0433\u0440\u0443\u0437\u043A\u0430 \u0441\u043E\u0437\u0434\u0430\u043D\u0430, \u0437\u0430\u043F\u0438\u0441\u044C \u0432 Google \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u0430: " + file.getUrl()
      );
      return file.getUrl();
    } finally {
      lock.releaseLock();
    }
  }
  function cancelMysqlMigrationFreeze() {
    const lock = LockService.getScriptLock();
    lock.waitLock(25e3);
    try {
      const properties = scriptProperties();
      properties.deleteProperty("GOOGLE_READ_ONLY");
      console.log("\u0417\u0430\u043F\u0438\u0441\u044C \u0432 Google \u0441\u043D\u043E\u0432\u0430 \u0440\u0430\u0437\u0440\u0435\u0448\u0435\u043D\u0430.");
      return { ok: true };
    } finally {
      lock.releaseLock();
    }
  }
  return __toCommonJS(main_exports);
})();
function doGet(e){return EscapeBackend.doGet(e);}
function doPost(e){return EscapeBackend.doPost(e);}
function setupDatabase(){return EscapeBackend.setupDatabase();}
function snapshotPreviousDay(){return EscapeBackend.snapshotPreviousDay();}
function prepareMysqlMigrationExport(){return EscapeBackend.prepareMysqlMigrationExport();}
function cancelMysqlMigrationFreeze(){return EscapeBackend.cancelMysqlMigrationFreeze();}
