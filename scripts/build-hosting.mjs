import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
const root = process.cwd();
const out = path.join(root, "hosting/dist");
await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, "www/assets"), { recursive: true });
await fs.cp("hosting/public", path.join(out, "www"), { recursive: true });
await fs.cp("public", path.join(out, "www"), { recursive: true });
await fs.mkdir(path.join(out, "escape-private"), { recursive: true });
await fs.copyFile(
  "hosting/server/gateway.php",
  path.join(out, "escape-private/gateway.php"),
);
await fs.copyFile(
  "hosting/server/config.example.php",
  path.join(out, "escape-private/config.php"),
);
const bundle = await build({
  entryPoints: ["hosting/client/main.tsx"],
  bundle: true,
  minify: true,
  write: false,
  metafile: true,
  platform: "browser",
  format: "esm",
  target: ["es2022"],
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  alias: {
    "@/lib/auth": path.join(root, "hosting/client/auth.ts"),
    "@/lib/data": path.join(root, "hosting/client/data.ts"),
    "next/link": path.join(root, "hosting/client/navigation.tsx"),
    "next/navigation": path.join(root, "hosting/client/navigation.tsx"),
  },
});
if (
  Object.keys(bundle.metafile.inputs).some((p) =>
    /google-client|lib\/password|google\/src/.test(p),
  )
)
  throw new Error("Server module leaked into frontend");
const js = bundle.outputFiles[0].contents;
const name =
  "app-" + createHash("sha256").update(js).digest("hex").slice(0, 12) + ".js";
await fs.writeFile(path.join(out, "www/assets", name), js);
const css = await postcss([tailwind({ base: root })]).process(
  await fs.readFile("app/globals.css", "utf8"),
  { from: path.join(root, "app/globals.css") },
);
const cssName =
  "app-" +
  createHash("sha256").update(css.css).digest("hex").slice(0, 12) +
  ".css";
await fs.writeFile(path.join(out, "www/assets", cssName), css.css);
await fs.writeFile(
  path.join(out, "www/index.html"),
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="theme-color" content="#f7f7f7"><meta name="application-name" content="ESCAPE"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="ESCAPE"><meta name="apple-mobile-web-app-status-bar-style" content="default"><title>ESCAPE · Чек-лист кухни</title><link rel="manifest" href="/manifest.json"><link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"><link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png"><link rel="icon" type="image/png" sizes="192x192" href="/icons/escape-192.png"><link rel="stylesheet" href="/assets/${cssName}"></head><body><div id="root"></div><noscript>Для работы приложения включите JavaScript.</noscript><script type="module" src="/assets/${name}"></script></body></html>`,
);
console.log("Host-0 build: hosting/dist (public + private; no secrets)");

await fs.copyFile(
  "hosting/server/.env.example",
  path.join(out, "escape-private/.env.example"),
);

await fs.copyFile(
  "hosting/server/snapshot.php",
  path.join(out, "escape-private/snapshot.php"),
);

for (const file of ["mysql.php", "mysql-schema.sql", "import-mysql.php", "check-mysql.php"]) {
  await fs.copyFile(`hosting/server/${file}`, path.join(out, "escape-private", file));
}

await fs.cp("hosting/admin", path.join(out,"www/admin"), {recursive:true});
for(const file of ["mysql-admin.php","admin-security.php","admin-schema.sql","admin-install.php"])
  await fs.copyFile(`hosting/server/${file}`, path.join(out,"escape-private",file));
