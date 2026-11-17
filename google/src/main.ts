import {
  BackendError,
  execute,
  seed,
  type Dependencies,
  writeActions,
} from "./core";
import {
  constantEqual,
  validateWebp,
  verifyPasswordBytes,
  hashPasswordBytes,
} from "./security";
import {
  readDatabase,
  commitDatabase,
  ensureSheets,
  migrateSheets,
} from "./sheets";
import { tableNames } from "./schema";
import { photoPaths } from "../../lib/task-photos";
import type { ApiResult, BackendRequest } from "../../types/models";
const prop = (name: string) => {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value) throw new Error("Missing configuration: " + name);
  return value;
};
const hex = (bytes: number[]) =>
  bytes.map((b) => (b & 255).toString(16).padStart(2, "0")).join("");
const utf8 = (value: string) =>
  new Uint8Array(
    Utilities.newBlob(value)
      .getBytes()
      .map((b) => b & 255),
  );
function deps(created: string[]): Dependencies {
  return {
    readOnly: migrationReadOnly(),
    now: () => new Date(),
    uuid: () => Utilities.getUuid(),
    hash: (value) =>
      hex(
        Utilities.computeDigest(
          Utilities.DigestAlgorithm.SHA_256,
          value,
          Utilities.Charset.UTF_8,
        ),
      ),
    verify: (password, encoded) =>
      verifyPasswordBytes(utf8(password), utf8, encoded),
    hashPassword: (password) =>
      hashPasswordBytes(
        utf8(password),
        Utilities.getUuid().replace(/-/g, ""),
        utf8,
      ),
    credentialFingerprint: (password) =>
      hex(
        Utilities.computeHmacSha256Signature(
          password,
          prop("GOOGLE_API_SECRET"),
          Utilities.Charset.UTF_8,
        ),
      ),
    bootstrapEnabled:
      PropertiesService.getScriptProperties().getProperty(
        "BOOTSTRAP_ENABLED",
      ) === "true",
    savePhoto: (base64, name) => {
      let bytes: number[];
      try {
        bytes = Utilities.base64Decode(base64);
        validateWebp(new Uint8Array(bytes.map((b) => b & 255)));
      } catch {
        throw new BackendError(
          "INVALID_PHOTO",
          "Некорректная фотография WebP.",
        );
      }
      const folder = DriveApp.getFolderById(prop("PHOTO_FOLDER_ID"));
      if (folder.getSharingAccess() !== DriveApp.Access.PRIVATE)
        throw new BackendError(
          "STORAGE_CONFIG",
          "Папка фотографий должна быть закрытой.",
          503,
        );
      const file = folder.createFile(
        Utilities.newBlob(bytes, "image/webp", name),
      );
      created.push(file.getId());
      if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) {
        file.setTrashed(true);
        throw new BackendError(
          "STORAGE_CONFIG",
          "Не удалось сохранить закрытую фотографию.",
          503,
        );
      }
      return file.getId();
    },
    getPhoto: (id) => {
      const file = DriveApp.getFileById(id);
      if (file.isTrashed())
        throw new BackendError("NOT_FOUND", "Фото не найдено.", 404);
      const blob = file.getBlob();
      return {
        base64: Utilities.base64Encode(blob.getBytes()),
        mimeType: "image/webp",
      };
    },
    trashPhoto: (id) => {
      try {
        DriveApp.getFileById(id).setTrashed(true);
      } catch {
        console.error("Orphan photo cleanup failed: " + id);
      }
    },
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
      "Система временно закрыта для переноса данных. Повторите позже.",
      503,
    );
}
function requireMysqlBridge() {
  if (scriptProperties().getProperty("MYSQL_BRIDGE_ENABLED") !== "true")
    throw new BackendError("FORBIDDEN", "Недостаточно прав.", 403);
}
function mysqlBridge(action: string, data: Record<string, unknown>): unknown {
  requireMysqlBridge();
  if (action === "bridgeVerify") {
    const password = data.password;
    const encoded = data.encoded;
    if (
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 128 ||
      typeof encoded !== "string" ||
      !/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(encoded)
    )
      throw new BackendError("INVALID_INPUT", "Некорректные данные пароля.");
    return { valid: verifyPasswordBytes(utf8(password), utf8, encoded) };
  }
  if (action === "bridgePhoto") {
    const fileId = data.fileId;
    if (typeof fileId !== "string" || !/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
      throw new BackendError("NOT_FOUND", "Фото не найдено.", 404);
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
      if (
        !expectedParent ||
        file.getSharingAccess() !== DriveApp.Access.PRIVATE
      )
        throw new Error("File is outside private storage");
      const bytes = file.getBlob().getBytes();
      validateWebp(new Uint8Array(bytes.map((b) => b & 255)));
      return {
        base64: Utilities.base64Encode(bytes),
        mimeType: "image/webp",
      };
    } catch {
      throw new BackendError("NOT_FOUND", "Фото не найдено.", 404);
    }
  }
  throw new BackendError("NOT_FOUND", "Неизвестное действие API.", 404);
}
export function doGet() {
  return json({ success: true, data: { service: "ESCAPE API" }, error: null });
}
function json(result: ApiResult) {
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
export function doPost(e: GoogleAppsScript.Events.DoPost) {
  let lock: GoogleAppsScript.Lock.Lock | undefined;
  const created: string[] = [];
  let committed = false;
  let commitAttempted = false;
  try {
    if (!e.postData?.contents || e.postData.contents.length > 18 * 1024 * 1024)
      throw new BackendError("INVALID_REQUEST", "Некорректный запрос.");
    const envelope = JSON.parse(e.postData.contents) as {
      payload: string;
      signature: string;
    };
    if (
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    )
      throw new BackendError("FORBIDDEN", "Недостаточно прав.", 403);
    const secret = prop("GOOGLE_API_SECRET");
    if (secret.length < 32) throw new Error("Secret too short");
    const expected = hex(
      Utilities.computeHmacSha256Signature(
        envelope.payload,
        secret,
        Utilities.Charset.UTF_8,
      ),
    );
    if (!constantEqual(expected, envelope.signature))
      throw new BackendError("FORBIDDEN", "Недостаточно прав.", 403);
    const request = JSON.parse(envelope.payload) as BackendRequest & {
      timestamp: number;
    };
    if (
      !Number.isFinite(request.timestamp) ||
      Math.abs(Date.now() - request.timestamp) > 300000 ||
      typeof request.action !== "string" ||
      !request.data ||
      typeof request.data !== "object"
    )
      throw new BackendError(
        "INVALID_REQUEST",
        "Запрос устарел или имеет неверный формат.",
      );
    if (request.action === "bridgeVerify" || request.action === "bridgePhoto")
      return json({
        success: true,
        data: mysqlBridge(request.action, request.data),
        error: null,
      });
    // Statistics may recover missing closed-day snapshots under the same lock.
    if (
      writeActions.includes(request.action) ||
      request.action === "getStatistics"
    ) {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(25000))
        throw new BackendError(
          "BUSY",
          "Система занята. Повторите запрос.",
          503,
        );
      if (writeActions.includes(request.action)) assertWritable();
    }
    const database = readDatabase(
      request.action === "getCurrentUser"
        ? ["users", "sessions"]
        : request.action === "getActivity"
          ? [
              "users",
              "sessions",
              "station_task_completions",
              "refrigerator_task_completions",
              "additional_tasks",
            ]
          : undefined,
    );
    const before = JSON.parse(JSON.stringify(database));
    const services = deps(created);
    const result = execute(database, services, request);
    commitAttempted = true;
    commitDatabase(before, database);
    committed = true;
    if (request.action === "bootstrap" && result.success) {
      PropertiesService.getScriptProperties().deleteProperty(
        "BOOTSTRAP_ENABLED",
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
              ...actual.additional_tasks,
            ].flatMap((c) => photoPaths(c.photo_path)),
          );
          created
            .filter((id) => !retained.has(id))
            .forEach((id) => deps([]).trashPhoto(id));
        } catch {
          console.error(
            "Uncertain photo commit; retained files for recovery: " +
              created.join(","),
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
          status: error.status,
        },
      });
    console.error(
      "Google backend failure: " +
        (error instanceof Error ? error.name : "UnknownError"),
    );
    return json({
      success: false,
      data: null,
      error: {
        code: "BACKEND_ERROR",
        message: "Не удалось выполнить действие. Попробуйте ещё раз.",
        status: 503,
      },
    });
  } finally {
    lock?.releaseLock();
  }
}
export function setupDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
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
export function snapshotPreviousDay() {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    assertWritable();
    const db = readDatabase(),
      before = JSON.parse(JSON.stringify(db));
    const result = execute(db, deps([]), {
      action: "snapshot",
      data: {},
      requestId: Utilities.getUuid(),
    });
    if (!result.success) throw new Error(result.error.message);
    commitDatabase(before, db);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Creates one immutable JSON export in the owner's private My Drive and freezes
 * all Google-backed writes. Run manually immediately before the MySQL import.
 */
export function prepareMysqlMigrationExport() {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const properties = scriptProperties();
    const previousId = properties.getProperty("MIGRATION_EXPORT_FILE_ID");
    if (migrationReadOnly()) {
      if (!previousId)
        throw new Error(
          "Google is read-only but the migration export is missing",
        );
      const previous = DriveApp.getFileById(previousId);
      console.log("Готовая выгрузка: " + previous.getUrl());
      return previous.getUrl();
    }

    const tables = readDatabase();
    // Sessions and retry/rate-limit bookkeeping are intentionally not migrated.
    tables.sessions = [];
    tables.login_attempts = [];
    tables.operations = [];
    const exportedAt = new Date().toISOString();
    const source = {
      format: "escape-mysql-v1",
      exportedAt,
      frozen: true,
      tables: Object.fromEntries(
        tableNames.map((name) => [name, tables[name]]),
      ),
    };
    const sourceJson = JSON.stringify(source);
    const sourceSha256 = hex(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        sourceJson,
        Utilities.Charset.UTF_8,
      ),
    );
    const document = JSON.stringify({ ...source, sourceSha256 });
    const name =
      "escape-mysql-migration-" + exportedAt.replace(/[:.]/g, "-") + ".json";
    const file = DriveApp.createFile(
      Utilities.newBlob(document, "application/json", name),
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
          MIGRATION_EXPORT_SHA256: sourceSha256,
        },
        false,
      );
    } catch (error) {
      file.setTrashed(true);
      throw error;
    }
    console.log(
      "Выгрузка создана, запись в Google остановлена: " + file.getUrl(),
    );
    return file.getUrl();
  } finally {
    lock.releaseLock();
  }
}

/** Restores Google writes if the MySQL cutover has to be cancelled. */
export function cancelMysqlMigrationFreeze() {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const properties = scriptProperties();
    properties.deleteProperty("GOOGLE_READ_ONLY");
    console.log("Запись в Google снова разрешена.");
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
