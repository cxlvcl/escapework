import { startPreview } from "../../scripts/preview-server";
startPreview({ test: true }).catch((error) => {
  console.error(error instanceof Error ? error.message : "Preview failed");
  process.exit(1);
});
