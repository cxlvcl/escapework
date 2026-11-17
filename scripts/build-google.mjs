import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("google/dist", { recursive: true });
await build({
  entryPoints: ["google/src/main.ts"],
  bundle: true,
  format: "iife",
  globalName: "EscapeBackend",
  target: "es2020",
  outfile: "google/dist/Code.js",
  footer: {
    js: "function doGet(e){return EscapeBackend.doGet(e);}\nfunction doPost(e){return EscapeBackend.doPost(e);}\nfunction setupDatabase(){return EscapeBackend.setupDatabase();}\nfunction snapshotPreviousDay(){return EscapeBackend.snapshotPreviousDay();}\nfunction prepareMysqlMigrationExport(){return EscapeBackend.prepareMysqlMigrationExport();}\nfunction cancelMysqlMigrationFreeze(){return EscapeBackend.cancelMysqlMigrationFreeze();}",
  },
});
await copyFile("google/appsscript.json", "google/dist/appsscript.json");
console.log("Apps Script bundle ready: google/dist/Code.js");
