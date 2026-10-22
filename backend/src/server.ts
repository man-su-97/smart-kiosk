import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate, seed, pool } from "./db/db.js";
import { seedUsers } from "./modules/auth/service.js";
import { hasDemoData, seedDemoData } from "./modules/demo/seedDemo.js";

await migrate();
await seed();
await seedUsers();
// Optional: fill an empty demo deployment with sample data (SEED_DEMO_DATA=true). Only once.
if (process.env.SEED_DEMO_DATA === "true" && !(await hasDemoData())) {
  await seedDemoData({ staffPassword: process.env.DEMO_STAFF_PASSWORD });
}

// Correctness does not depend on this: every query already checks expires_at.
// This only writes the 'expired' status into the table so it is visible there.
setInterval(() => {
  pool
    .query("UPDATE orders SET status = 'expired' WHERE status IN ('pending', 'pending_cash_approval') AND expires_at <= clock_timestamp()")
    .catch((err) => console.error("expiry job failed", err));
  pool.query("DELETE FROM sessions WHERE expires_at <= now()").catch((err) => console.error("session cleanup failed", err));
}, 5000);

createApp().listen(config.port, () => console.log(`API listening on :${config.port}`));
