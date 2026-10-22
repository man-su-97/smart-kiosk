import { createApp } from "./app.js";
import { config } from "./config.js";
import { migrate, seed, pool } from "./db/db.js";

await migrate();
await seed();

// Correctness does not depend on this: every query already checks expires_at.
// This only writes the 'expired' status into the table so it is visible there.
setInterval(() => {
  pool
    .query("UPDATE orders SET status = 'expired' WHERE status = 'pending' AND expires_at <= clock_timestamp()")
    .catch((err) => console.error("expiry job failed", err));
}, 5000);

createApp().listen(config.port, () => console.log(`API listening on :${config.port}`));
