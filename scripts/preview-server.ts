// Explicit local preview/test harness only; the production transport never falls back to it.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { fixture } from "../tests/helpers";
import { seedPhotoArchive } from "../tests/photo-archive-fixture";
import { execute } from "../google/src/core";
import { hashPassword } from "../lib/password";
import type { BackendRequest } from "../types/models";
export async function startPreview({ test = false }: { test?: boolean } = {}) {
  const f = fixture(new Date());
  f.deps.now = () => new Date();
  const secret = randomBytes(32).toString("hex");
  const name = test ? "Тест Су-шеф" : process.env.BOOTSTRAP_SOUS_CHEF_NAME;
  const login = test ? "sous" : process.env.BOOTSTRAP_SOUS_CHEF_LOGIN;
  const password = test
    ? "test-password-123"
    : process.env.BOOTSTRAP_SOUS_CHEF_PASSWORD;
  if (!name || !login || !password)
    throw new Error(
      "Задайте BOOTSTRAP_SOUS_CHEF_* в .env для локального просмотра.",
    );
  f.db.users.push({
    id: randomUUID(),
    name,
    login,
    password_hash: await hashPassword(password),
    role: "sous_chef",
    active_station_id: null,
  });
  if (test) {
    const hash = await hashPassword("test-password-123");
    for (const [login, name, role] of [
      ["cook-a", "Тест Повар A", "cook"],
      ["cook-b", "Тест Повар B", "cook"],
      ["chef", "Тест Шеф", "chef"],
      ["audit", "Тест Аудит", "audit"],
    ] as const)
      f.db.users.push({
        id: randomUUID(),
        name,
        login,
        password_hash: hash,
        role,
        active_station_id: null,
      });
    f.db.additional_task_types.push({
      id: randomUUID(),
      title: "Тип только для автоматического теста",
      is_active: true,
    });
  }
  if (test) await seedPhotoArchive(f);
  const apiPort = test
      ? 54331
      : Number(process.env.ESCAPE_PREVIEW_API_PORT ?? 54332),
    appPort = test ? 3101 : Number(process.env.ESCAPE_PREVIEW_PORT ?? 3100);
  const api = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method !== "POST") {
      res.end(
        JSON.stringify({
          success: true,
          data: { service: "local-test" },
          error: null,
        }),
      );
      return;
    }
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const expected = createHmac("sha256", secret)
        .update(body.payload)
        .digest("hex");
      if (
        typeof body.signature !== "string" ||
        body.signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(expected), Buffer.from(body.signature))
      )
        throw new Error("Invalid signature");
      const request = JSON.parse(body.payload) as BackendRequest & {
        timestamp: number;
      };
      if (Math.abs(Date.now() - request.timestamp) > 300000)
        throw new Error("Expired");
      res.end(JSON.stringify(execute(f.db, f.deps, request)));
    } catch {
      res.end(
        JSON.stringify({
          success: false,
          data: null,
          error: {
            code: "ERROR",
            message: "Ошибка тестового backend.",
            status: 503,
          },
        }),
      );
    }
  });
  await new Promise<void>((resolve) =>
    api.listen(apiPort, "127.0.0.1", resolve),
  );
  const next = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(appPort)],
    {
      env: {
        ...process.env,
        GOOGLE_API_URL: `http://127.0.0.1:${apiPort}`,
        GOOGLE_API_SECRET: secret,
        CRON_SECRET: randomBytes(32).toString("hex"),
      },
      stdio: "inherit",
    },
  );
  const stop = () => {
    next.kill("SIGTERM");
    api.close();
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  next.on("exit", () => api.close());
  console.log(
    `Локальный ${test ? "тест" : "просмотр"}: http://localhost:${appPort}. Данные временные; облачный Google не подключён.`,
  );
}
