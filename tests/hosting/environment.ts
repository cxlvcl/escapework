import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "../helpers";
import { seedPhotoArchive } from "../photo-archive-fixture";
import { execute } from "../../google/src/core";
import { hashPassword } from "../../lib/password";
export async function startHosting(preview = false) {
  const configDirectory = mkdtempSync(join(tmpdir(), "escape-php-test-"));
  const configPath = join(configDirectory, "config.php");
  const f = fixture(new Date());
  f.deps.now = () => new Date();
  const password = preview
    ? process.env.BOOTSTRAP_SOUS_CHEF_PASSWORD
    : "test-password-123";
  if (!password) throw new Error("BOOTSTRAP_SOUS_CHEF_PASSWORD missing");
  const hash = await hashPassword(password);
  const accounts = preview
    ? [
        [
          process.env.BOOTSTRAP_SOUS_CHEF_LOGIN || "Артем",
          process.env.BOOTSTRAP_SOUS_CHEF_NAME || "Артем",
          "sous_chef",
        ] as const,
      ]
    : ([
        ["sous", "Тест Су-шеф", "sous_chef"],
        ["cook-a", "Тест Повар A", "cook"],
        ["cook-b", "Тест Повар B", "cook"],
        ["chef", "Тест Шеф", "chef"],
        ["audit", "Тест Аудит", "audit"],
      ] as const);
  for (const [login, name, role] of accounts)
    f.db.users.push({
      id: randomUUID(),
      name,
      login,
      role,
      password_hash: hash,
      active_station_id: null,
    });
  if (!preview)
    f.db.additional_task_types.push({
      id: randomUUID(),
      title: "Тип только для автоматического теста",
      is_active: true,
    });
  if (!preview) await seedPhotoArchive(f);
  const secret = randomBytes(32).toString("hex");
  const api = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (
        createHmac("sha256", secret).update(body.payload).digest("hex") !==
        body.signature
      )
        throw new Error("Signature");
      const request = JSON.parse(body.payload);
      if (Math.abs(Date.now() - request.timestamp) > 300000)
        throw new Error("Time");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(execute(f.db, f.deps, request)));
    } catch {
      res.statusCode = 503;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) =>
    api.listen(preview ? 54340 : 54339, "127.0.0.1", resolve),
  );
  writeFileSync(
    configPath,
    `<?php return ['origin'=>'http://localhost:${preview ? 3102 : 3101}','google_url'=>'http://127.0.0.1:${preview ? 54340 : 54339}','google_secret'=>'${secret}','cron_secret'=>'${secret}'];`,
    { mode: 0o600 },
  );
  const php = spawn(
    process.env.ESCAPE_PHP_BIN || "php",
    [
      "-d",
      "upload_max_filesize=3M",
      "-d",
      "post_max_size=13M",
      "-S",
      preview ? "localhost:3102" : "localhost:3101",
      "-t",
      "hosting/dist/www",
      "tests/hosting/router.php",
    ],
    {
      env: {
        ...process.env,
        ESCAPE_PHP_TEST: "1",
        ESCAPE_PHP_CONFIG: configPath,
      },
      stdio: "inherit",
    },
  );
  const cleanup = () => {
    php.kill();
    api.close();
    rmSync(configDirectory, { force: true, recursive: true });
  };
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  php.on("error", () => {
    cleanup();
    process.exit(1);
  });
  php.on("exit", () => {
    cleanup();
    process.exit();
  });
}
if (!process.env.ESCAPE_HOSTING_PREVIEW) void startHosting();
