import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share one real Postgres database, so run test files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup_test",
      WEBHOOK_SECRET: "test-secret",
      ENABLE_PAYMENT_SIMULATOR: "true",
      ADMIN_PASSWORD: "test-admin-password",
      LOCKER_KEY: "test-locker-key",
      // Off by default in tests (they place many orders from one address); the limiter has its own tests.
      MAX_OPEN_HOLDS_PER_CLIENT: "0",
      MAX_ORDERS_PER_CLIENT_PER_10_MIN: "0",
    },
  },
});
