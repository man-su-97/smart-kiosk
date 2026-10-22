import { defineConfig } from "@playwright/test";

// Expects the app to already be running: `docker compose up` from the repo root.
export default defineConfig({
  testDir: "./tests",
  workers: 1, // all tests share one database and one stock, so run one at a time
  timeout: 30_000,
  use: { baseURL: "http://localhost:5173", screenshot: "only-on-failure" },
});
