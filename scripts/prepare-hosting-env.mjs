import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parse } from "dotenv";
const env = parse(await readFile(".env"));
const fields = {
  APP_ORIGIN: "https://escapeworkspaceru.ru",
  GOOGLE_API_URL: env.GOOGLE_API_URL,
  GOOGLE_API_SECRET: env.GOOGLE_API_SECRET,
  CRON_SECRET: env.CRON_SECRET,
};
if (
  !fields.GOOGLE_API_URL ||
  (fields.GOOGLE_API_SECRET?.length ?? 0) < 32 ||
  (fields.CRON_SECRET?.length ?? 0) < 32
)
  throw new Error("Missing hosting environment settings");
await mkdir("hosting/private-upload", { recursive: true, mode: 0o700 });
await writeFile(
  "hosting/private-upload/.env",
  Object.entries(fields)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
console.log(
  "Private environment prepared: hosting/private-upload/.env — upload ONLY to escape-private, never www.",
);
