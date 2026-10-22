// All settings come from environment variables, with defaults that work for local dev.
export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup",
  // Shared secret between us and the (simulated) payment provider.
  webhookSecret: process.env.WEBHOOK_SECRET ?? "dev-webhook-secret",
  // How long an unpaid order holds its stock.
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
};
