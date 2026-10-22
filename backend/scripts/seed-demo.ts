// Usage: npm run seed-demo -- [days]      (default 7; in Docker: docker compose exec api npm run seed-demo)
// Fills the database with clearly-marked sample kiosks, staff, a duty roster and past sales,
// so the dashboard and the PDF report have something to show. Running it again replaces the sample.
import { migrate, pool, seed } from "../src/db/db.js";
import { seedUsers } from "../src/modules/auth/service.js";
import { seedDemoData } from "../src/modules/demo/seedDemo.js";

const days = Number(process.argv[2] ?? 7);
await migrate();
await seed();
await seedUsers();
const { bills } = await seedDemoData({ days, staffPassword: process.env.DEMO_STAFF_PASSWORD });
console.log(`Sample data ready: ${bills} bills over ${days} days, 3 kiosks, 4 staff on the roster.`);
await pool.end();
