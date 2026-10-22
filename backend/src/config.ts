const isProduction = process.env.NODE_ENV === "production";

// Dev defaults are fine locally. In production a missing secret stops the app instead of
// silently using a value that anyone can read in the public repo.
function secret(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value) return value;
  if (isProduction) throw new Error(`${name} must be set in production`);
  return devDefault;
}

// The mock-UPI simulator lets anyone mark an order paid (free goods), so it is off in production
// unless a demo deployment explicitly opts in.
export function paymentSimulatorAllowed(env: NodeJS.ProcessEnv): boolean {
  if (env.ENABLE_PAYMENT_SIMULATOR !== "true") return false;
  return env.NODE_ENV !== "production" || env.ALLOW_SIMULATOR_IN_PRODUCTION === "true";
}

// All settings come from environment variables, with defaults that work for local dev.
export const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3000),
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/pickup",
  // Shared secret between us and the (simulated) payment provider.
  webhookSecret: secret("WEBHOOK_SECRET", "dev-webhook-secret"),
  // Demo only: lets the phone "mock UPI" page mark an order paid (anyone can call it: free goods).
  // Off in production unless a demo deployment opts in with ALLOW_SIMULATOR_IN_PRODUCTION=true.
  paymentSimulator: paymentSimulatorAllowed(process.env),
  // The locker controller sends this in X-Locker-Key; without it anyone knowing an order id could open the locker.
  lockerKey: secret("LOCKER_KEY", "dev-locker-key"),
  // Stops one client (a script) holding all the stock: open unpaid holds and orders per 10 minutes,
  // per IP address. 0 = no limit.
  maxOpenHoldsPerClient: Number(process.env.MAX_OPEN_HOLDS_PER_CLIENT ?? 5),
  maxOrdersPerClientPer10Min: Number(process.env.MAX_ORDERS_PER_CLIENT_PER_10_MIN ?? 40),
  // Cash handed over just before the hold ran out can still be approved for this long afterwards.
  cashGraceMinutes: Number(process.env.CASH_GRACE_MINUTES ?? 10),
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
