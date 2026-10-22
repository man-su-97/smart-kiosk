// All settings come from environment variables, with defaults that work for local dev.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup",
  // Shared secret between us and the (simulated) payment provider.
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  // Demo only: lets the screen pretend a cash acceptor took the money. Real cash hardware
  // would authenticate itself; an open "mark as paid" endpoint must never be on in production.
  cashSimulator: process.env.ENABLE_CASH_SIMULATOR === "true",
  // How long an unpaid order holds its stock.
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
};
