// All settings come from environment variables, with defaults that work for local dev.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup",
  // Shared secret between us and the (simulated) payment provider.
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  // Demo only: lets the phone "mock UPI" page mark an order paid. A real bank would call the
  // signed webhook instead; an open "mark as paid" endpoint must never be on in production.
  paymentSimulator: process.env.ENABLE_PAYMENT_SIMULATOR === "true",
  // Password for the operator (/admin) endpoints that approve cash. Change it outside the demo.
  adminToken: process.env.ADMIN_TOKEN ?? "demo-admin-token",
  // Deployed only: folder with the built frontend, served by Express. Unset locally.
  staticDir: process.env.STATIC_DIR,
  // How long an unpaid order holds its stock.
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
};
