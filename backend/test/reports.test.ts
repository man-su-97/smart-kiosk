import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { api, claim, loginAs, placeOrder, resetDb, sendWebhook, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

let admin: Record<string, string>;
let staffId: number;

// A fixed week of sales, with paid_at moved to known times (in India time, +05:30):
//   1 Oct 10:00  2 × chips          paid            -> 1 Oct
//   2 Oct 00:30  1 × drink          paid + claimed  -> 2 Oct in India (still 1 Oct in UTC!)
//   3 Oct 12:00  1 × chips          cash, approved  -> 3 Oct
//   plus one needs_review (wrong amount) and one unpaid order: neither counts as sold.
beforeEach(async () => {
  await resetDb();
  admin = (await loginAs("admin")).headers;
  const staff = await loginAs("staff");
  staffId = staff.user.id;

  const insert = (name: string, category: string, price: number, cost: number) =>
    pool
      .query(
        "INSERT INTO products (name, category, price_paise, cost_paise, stock) VALUES ($1, $2, $3, $4, 20) RETURNING id",
        [name, category, price, cost],
      )
      .then((r) => r.rows[0].id as number);
  const chips = await insert("Chips", "chips", 2000, 1200);
  const drink = await insert("Cola", "drinks", 6000, 3500);

  const paidAt = (orderId: string, at: string) =>
    pool.query("UPDATE orders SET paid_at = $2 WHERE id = $1", [orderId, at]);

  const o1 = await placeOrder(chips, 2).then((r) => r.json());
  await sendWebhook({ eventId: "evt_1", orderId: o1.id, amountPaise: 4000 });
  await paidAt(o1.id, "2026-10-01 10:00+05:30");

  const o2 = await placeOrder(drink, 1).then((r) => r.json());
  await sendWebhook({ eventId: "evt_2", orderId: o2.id, amountPaise: 6000 });
  await claim(o2.id);
  await paidAt(o2.id, "2026-10-02 00:30+05:30");

  const o3 = await placeOrder(chips, 1).then((r) => r.json());
  await api(`/orders/${o3.id}/cash-request`, { method: "POST" });
  await api(`/admin/orders/${o3.id}/approve-cash`, { method: "POST", headers: staff.headers });
  await paidAt(o3.id, "2026-10-03 12:00+05:30");
  await pool.query("UPDATE payment_events SET received_at = '2026-10-03 12:00+05:30' WHERE source = 'cash'");

  const o4 = await placeOrder(chips, 1).then((r) => r.json());
  await sendWebhook({ eventId: "evt_4", orderId: o4.id, amountPaise: 1 }); // wrong amount -> needs_review
  await placeOrder(drink, 1); // never paid
});

const get = (path: string, headers = admin) => api(path, { headers });
const RANGE = "from=2026-10-01&to=2026-10-04";

describe("analytics", () => {
  it("summary: revenue, cost, profit, orders, units and cash collected", async () => {
    const summary = await get(`/admin/analytics/summary?${RANGE}`).then((r) => r.json());
    expect(summary).toMatchObject({
      revenuePaise: 12000, // 4000 + 6000 + 2000
      costPaise: 7100, // 2400 + 3500 + 1200
      profitPaise: 4900,
      orders: 3,
      units: 4,
      cashCollectedPaise: 2000,
      cashByOperator: [{ operatorId: staffId, email: "staff@test.local", approvals: 1, amountPaise: 2000 }],
    });
  });

  it("daily: one row per India day, including days with no sales", async () => {
    const days = await get(`/admin/analytics/daily?${RANGE}`).then((r) => r.json());
    expect(days).toEqual([
      { day: "2026-10-01", revenuePaise: 4000, profitPaise: 1600, orders: 1 },
      { day: "2026-10-02", revenuePaise: 6000, profitPaise: 2500, orders: 1 }, // the 00:30 sale
      { day: "2026-10-03", revenuePaise: 2000, profitPaise: 800, orders: 1 },
      { day: "2026-10-04", revenuePaise: 0, profitPaise: 0, orders: 0 },
    ]);
  });

  it("by category and top products", async () => {
    expect(await get(`/admin/analytics/categories?${RANGE}`).then((r) => r.json())).toEqual([
      { category: "chips", units: 3, revenuePaise: 6000 },
      { category: "drinks", units: 1, revenuePaise: 6000 },
    ]);
    const top = await get(`/admin/analytics/top-products?${RANGE}`).then((r) => r.json());
    expect(top.map((p: { name: string; units: number }) => [p.name, p.units])).toEqual([
      ["Chips", 3],
      ["Cola", 1],
    ]);
  });

  it("a one-day range only sees that day", async () => {
    const day = await get("/admin/analytics/summary?from=2026-10-02&to=2026-10-02").then((r) => r.json());
    expect(day).toMatchObject({ revenuePaise: 6000, orders: 1, cashCollectedPaise: 0 });
  });

  it("validates the date range", async () => {
    for (const q of ["from=2026-10-05&to=2026-10-01", "from=2026-02-30&to=2026-03-01", "from=yesterday&to=2026-10-01", "from=2025-01-01&to=2026-10-01", ""]) {
      expect((await get(`/admin/analytics/summary?${q}`)).status, q).toBe(400);
    }
  });
});

describe("daily PDF report", () => {
  it("downloads a PDF for admins", async () => {
    const res = await get("/admin/reports/daily-pdf?date=2026-10-01");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="sales-2026-10-01.pdf"');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it("refuses staff, anonymous users and bad dates", async () => {
    const staff = (await loginAs("staff", "second@test.local")).headers;
    expect((await get("/admin/reports/daily-pdf?date=2026-10-01", staff)).status).toBe(403);
    expect((await get("/admin/reports/daily-pdf?date=2026-10-01", {})).status).toBe(401);
    expect((await get("/admin/reports/daily-pdf?date=2026-13-01")).status).toBe(400);
  });
});

describe("bill register (PDF rows)", () => {
  it("each bill has its number, India time, kiosk, payment mode and the right person", async () => {
    const { bills } = await import("../src/modules/reports/service.js");
    const { rows: kiosk } = await pool.query("INSERT INTO kiosks (code, name) VALUES ('KSK-T1', 'Test kiosk') RETURNING id");
    const onDuty = await loginAs("staff", "duty@test.local");
    const cashier = await loginAs("staff", "cashier@test.local");
    await pool.query(
      "INSERT INTO kiosk_shifts (kiosk_id, user_id, starts_at, ends_at) VALUES ($1, $2, now() - interval '1 hour', now() + interval '1 hour')",
      [kiosk[0].id, onDuty.user.id],
    );
    const { rows: product } = await pool.query("SELECT id FROM products WHERE name = 'Chips'");
    const order = (quantity: number) =>
      api("/orders", { method: "POST", body: { items: [{ productId: product[0].id, quantity }], kioskCode: "KSK-T1" } }).then((r) => r.json());

    const upi = await order(1);
    await sendWebhook({ eventId: "evt_upi", orderId: upi.id, amountPaise: 2000 });
    const cash = await order(2);
    await api(`/orders/${cash.id}/cash-request`, { method: "POST" });
    await api(`/admin/orders/${cash.id}/approve-cash`, { method: "POST", headers: cashier.headers });
    await pool.query("UPDATE orders SET paid_at = '2026-10-10 19:45+05:30' WHERE id = ANY($1)", [[upi.id, cash.id]]);

    const register = await bills({ from: "2026-10-10", to: "2026-10-10" });
    expect(register.map((b) => [b.kioskCode, b.paymentMode, b.staff, b.amountPaise, b.time, b.date])).toEqual([
      ["KSK-T1", "UPI", "duty@test.local", 2000, "07:45 PM", "10 Oct 2026"], // UPI: who was on duty
      ["KSK-T1", "Cash", "cashier@test.local", 4000, "07:45 PM", "10 Oct 2026"], // cash: who took the money
    ]);
    expect(register.every((b) => /^BILL-\d{6}$/.test(b.billNo) && !b.demo)).toBe(true);
  });
});
