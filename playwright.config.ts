import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60000,
  use: {
    baseURL: "http://localhost:3101",
    viewport: { width: 390, height: 844 },
    headless: true,
  },
  webServer: {
    command: "node --import tsx tests/e2e/environment.ts",
    url: "http://localhost:3101/login",
    timeout: 120000,
    reuseExistingServer: false,
  },
  reporter: "list",
});
