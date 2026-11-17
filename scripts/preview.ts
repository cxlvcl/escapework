import "dotenv/config";
import { startPreview } from "./preview-server";
startPreview().catch((error) => {
  console.error(error instanceof Error ? error.message : "Preview failed");
  process.exit(1);
});
