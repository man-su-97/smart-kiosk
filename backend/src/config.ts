const isProduction = process.env.NODE_ENV === "production";

// Dev defaults are fine locally. In production a missing secret stops the app instead of
// silently using a value that anyone can read in the public repo.
function secret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devDefault;
}

// All settings come from environment variables, with defaults that work for local dev.
export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup",
  // Shared secret between us and the (simulated) payment provider.
  webhookSecret: secret("WEBHOOK_SECRET", "dev-webhook-secret"),
  // Demo only: lets the phone "mock UPI" page mark an order paid. A real bank would call the
  // signed webhook instead; an open "mark as paid" endpoint must never be on in production.
  paymentSimulator: process.env.ENABLE_PAYMENT_SIMULATOR === "true",
  // First admin account, created at start when there are no users yet.
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@kiosk.local",
  adminPassword: secret("ADMIN_PASSWORD", "admin12345"),
  // Optional demo staff account, created at start if both are set and it does not exist yet.
  staffEmail: process.env.STAFF_EMAIL,
  staffPassword: process.env.STAFF_PASSWORD,
  // Reports group sales by calendar day in this time zone.
  reportTimeZone: process.env.REPORT_TZ ?? "Asia/Kolkata",
  // Deployed only: folder with the built frontend, served by Express. Unset locally.
  staticDir: process.env.STATIC_DIR,
  // How long an unpaid order holds its stock.
  holdSeconds: Number(process.env.HOLD_SECONDS ?? 120),
};
