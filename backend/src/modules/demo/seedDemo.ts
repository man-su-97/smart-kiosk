import { randomBytes } from "node:crypto";
import { pool, withTransaction, type Tx } from "../../db/db.js";
import { createUser } from "../auth/service.js";

// Sample data for demos and shareable reports: three Bengaluru kiosks, four staff on a duty
// roster, and a week of past sales (UPI and cash). Running it again replaces the previous sample.
// The numbers are random but repeatable (fixed seed), so every run tells the same story.
// Sample sales are recorded as already collected and do not change stock (they are history).
// Everything sample is recognisable: payment event ids start with "demo_", emails end in .demo@kiosk.local,
// and the PDF report says "Contains sample (demo) data".

const KIOSKS = [
  { code: "KSK-BLR-01", name: "MG Road Metro", location: "MG Road, Bengaluru" },
  { code: "KSK-BLR-02", name: "Koramangala Tech Park", location: "Koramangala, Bengaluru" },
  { code: "KSK-BLR-03", name: "Indiranagar Mall", location: "Indiranagar, Bengaluru" },
];
const STAFF = [
  { name: "Priya Sharma", email: "priya.demo@kiosk.local" },
  { name: "Arjun Rao", email: "arjun.demo@kiosk.local" },
  { name: "Meera Iyer", email: "meera.demo@kiosk.local" },
  { name: "Rahul Verma", email: "rahul.demo@kiosk.local" },
];
// Two shifts a day per kiosk, India time.
const SHIFTS = [
  { start: 8, end: 14 },
  { start: 14, end: 20 },
];

// Small repeatable random number generator (mulberry32).
function random(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seedDemoData({ days = 7, staffPassword }: { days?: number; staffPassword?: string } = {}) {
  // People first (outside the transaction: createUser uses its own connection).
  const staffIds: number[] = [];
  for (const person of STAFF) {
    const { rows } = await pool.query("SELECT id FROM users WHERE email = $1", [person.email]);
    // Without a configured password the demo accounts get a random one: they appear on reports
    // but nobody can log in as them on a public demo.
    staffIds.push(rows[0]?.id ?? (await createUser(person.email, staffPassword ?? randomBytes(24).toString("hex"), "staff", person.name)).id);
  }

  return withTransaction(async (tx) => {
    await removeDemoSales(tx);

    const kioskIds: number[] = [];
    for (const k of KIOSKS) {
      const { rows } = await tx.query(
        `INSERT INTO kiosks (code, name, location) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, location = EXCLUDED.location, active = true
         RETURNING id`,
        [k.code, k.name, k.location],
      );
      kioskIds.push(rows[0].id);
    }

    const { rows: products } = await tx.query(
      "SELECT id, price_paise, cost_paise FROM products WHERE active ORDER BY id",
    );
    if (products.length === 0) return { bills: 0 };

    // Today in India, and "now" as minutes since midnight India time.
    const { rows: clock } = await tx.query(
      `SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date AS today,
              EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata') * 60 + EXTRACT(MINUTE FROM now() AT TIME ZONE 'Asia/Kolkata') AS minute_now`,
    );
    const minuteNow = Number(clock[0].minute_now);

    // Roster from `days` ago until a week ahead. Who works where rotates each day; within one
    // shift the three kiosks always get three different people, so no overlaps.
    await tx.query("DELETE FROM kiosk_shifts WHERE kiosk_id = ANY($1)", [kioskIds]);
    const onDuty = (day: number, kiosk: number, shift: number) => staffIds[(day + kiosk + shift * 2) % staffIds.length];
    for (let day = -(days - 1); day <= 7; day++) {
      for (let k = 0; k < kioskIds.length; k++) {
        for (let s = 0; s < SHIFTS.length; s++) {
          await tx.query(
            `INSERT INTO kiosk_shifts (kiosk_id, user_id, starts_at, ends_at, note)
             VALUES ($1, $2,
                     (($3::date + $4::int) + make_interval(hours => $5)) AT TIME ZONE 'Asia/Kolkata',
                     (($3::date + $4::int) + make_interval(hours => $6)) AT TIME ZONE 'Asia/Kolkata',
                     'sample roster')`,
            [kioskIds[k], onDuty(day + 100, k, s), clock[0].today, day, SHIFTS[s].start, SHIFTS[s].end],
          );
        }
      }
    }

    // Sales, oldest first so bill numbers go up with time.
    const rand = random(42);
    const sales: { day: number; minute: number; kiosk: number }[] = [];
    for (let day = -(days - 1); day <= 0; day++) {
      const count = 12 + Math.floor(rand() * 9);
      for (let i = 0; i < count; i++) {
        const minute = 8 * 60 + Math.floor(rand() * 12 * 60); // between 08:00 and 20:00
        if (day === 0 && minute > minuteNow - 5) continue; // nothing in the future
        sales.push({ day, minute, kiosk: Math.floor(rand() * kioskIds.length) });
      }
    }
    sales.sort((a, b) => a.day - b.day || a.minute - b.minute);

    for (const sale of sales) {
      const lines = new Map<number, { price: number; cost: number; quantity: number }>();
      const lineCount = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < lineCount; i++) {
        const p = products[Math.floor(rand() * products.length)];
        const line = lines.get(p.id) ?? { price: p.price_paise, cost: p.cost_paise, quantity: 0 };
        line.quantity += 1 + Math.floor(rand() * 2);
        lines.set(p.id, line);
      }
      const total = [...lines.values()].reduce((n, l) => n + l.price * l.quantity, 0);
      const shift = sale.minute < SHIFTS[1].start * 60 ? 0 : 1;
      const agent = onDuty(sale.day + 100, sale.kiosk, shift);
      const cash = rand() < 0.35;

      const { rows } = await tx.query(
        `INSERT INTO orders (status, total_paise, kiosk_id, agent_user_id, created_at, expires_at, paid_at, claimed_at)
         SELECT 'claimed', $1, $2, $3, t - interval '1 minute', t + interval '1 minute', t, t + interval '3 minutes'
           FROM (SELECT (($4::date + $5::int) + make_interval(mins => $6)) AT TIME ZONE 'Asia/Kolkata' AS t) x
         RETURNING id, paid_at`,
        [total, kioskIds[sale.kiosk], agent, clock[0].today, sale.day, sale.minute],
      );
      const order = rows[0];
      for (const [productId, l] of lines) {
        await tx.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise, unit_cost_paise)
           VALUES ($1, $2, $3, $4, $5)`,
          [order.id, productId, l.quantity, l.price, l.cost],
        );
      }
      await tx.query(
        `INSERT INTO payment_events (event_id, order_id, status, amount_paise, source, operator_id, outcome, received_at)
         VALUES ('demo_' || gen_random_uuid(), $1, 'captured', $2, $3, $4, 'paid', $5)`,
        [order.id, total, cash ? "cash" : "webhook", cash ? agent : null, order.paid_at],
      );
    }
    return { bills: sales.length };
  });
}

export async function hasDemoData() {
  const { rows } = await pool.query("SELECT 1 FROM payment_events WHERE event_id LIKE 'demo\\_%' LIMIT 1");
  return rows.length > 0;
}

async function removeDemoSales(tx: Tx) {
  const { rows } = await tx.query("SELECT order_id FROM payment_events WHERE event_id LIKE 'demo\\_%'");
  const ids = rows.map((r) => r.order_id);
  await tx.query("DELETE FROM payment_events WHERE order_id = ANY($1)", [ids]);
  await tx.query("DELETE FROM order_items WHERE order_id = ANY($1)", [ids]);
  await tx.query("DELETE FROM orders WHERE id = ANY($1)", [ids]);
}
