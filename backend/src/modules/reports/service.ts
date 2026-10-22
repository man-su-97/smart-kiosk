import { pool } from "../../db/db.js";
import { config } from "../../config.js";

// A date range in the report time zone, both ends included: "2026-10-01" .. "2026-10-07".
export type Range = { from: string; to: string };

// "Sold" = the order was paid (and maybe already collected). Sales are counted on the day they
// were paid, in the report time zone (Asia/Kolkata), not UTC: a sale at 11:30 pm IST belongs to
// that IST day. Revenue and cost come from the price/cost saved on each order line.
const SOLD_LINES = `
  FROM orders o
  JOIN order_items oi ON oi.order_id = o.id
  JOIN products p ON p.id = oi.product_id
 WHERE o.status IN ('paid', 'claimed')
   AND (o.paid_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`;

const params = (r: Range) => [r.from, r.to, config.reportTimeZone];

// SUM(...) returns a Postgres bigint, which pg gives back as a string; turn it into a number.
const num = (value: string | number | null) => Number(value ?? 0);

export async function summary(range: Range) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(oi.quantity * oi.unit_price_paise), 0) AS revenue,
            COALESCE(SUM(oi.quantity * oi.unit_cost_paise), 0)  AS cost,
            COUNT(DISTINCT o.id)                                AS orders,
            COALESCE(SUM(oi.quantity), 0)                       AS units
     ${SOLD_LINES}`,
    params(range),
  );
  const cash = await cashByOperator(range);
  const revenuePaise = num(rows[0].revenue);
  const costPaise = num(rows[0].cost);
  return {
    ...range,
    revenuePaise,
    costPaise,
    profitPaise: revenuePaise - costPaise,
    orders: num(rows[0].orders),
    units: num(rows[0].units),
    cashCollectedPaise: cash.reduce((sum, c) => sum + c.amountPaise, 0),
    cashByOperator: cash,
  };
}

// One row per day, including days with no sales (generate_series fills the gaps with 0).
export async function daily(range: Range) {
  const { rows } = await pool.query(
    `WITH sales AS (
       SELECT (o.paid_at AT TIME ZONE $3)::date AS day,
              SUM(oi.quantity * oi.unit_price_paise) AS revenue,
              SUM(oi.quantity * oi.unit_cost_paise)  AS cost,
              COUNT(DISTINCT o.id)                   AS orders
       ${SOLD_LINES}
       GROUP BY 1
     )
     SELECT to_char(d, 'YYYY-MM-DD') AS day,
            COALESCE(s.revenue, 0) AS revenue, COALESCE(s.cost, 0) AS cost, COALESCE(s.orders, 0) AS orders
       FROM generate_series($1::date, $2::date, interval '1 day') AS d
       LEFT JOIN sales s ON s.day = d::date
      ORDER BY d`,
    params(range),
  );
  return rows.map((r) => ({
    day: r.day as string,
    revenuePaise: num(r.revenue),
    profitPaise: num(r.revenue) - num(r.cost),
    orders: num(r.orders),
  }));
}

export async function byCategory(range: Range) {
  const { rows } = await pool.query(
    `SELECT p.category, SUM(oi.quantity) AS units, SUM(oi.quantity * oi.unit_price_paise) AS revenue
     ${SOLD_LINES}
     GROUP BY p.category
     ORDER BY revenue DESC, p.category`,
    params(range),
  );
  return rows.map((r) => ({ category: r.category as string, units: num(r.units), revenuePaise: num(r.revenue) }));
}

export async function topProducts(range: Range, limit = 10) {
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.category, SUM(oi.quantity) AS units,
            SUM(oi.quantity * oi.unit_price_paise) AS revenue,
            SUM(oi.quantity * (oi.unit_price_paise - oi.unit_cost_paise)) AS profit
     ${SOLD_LINES}
     GROUP BY p.id
     ORDER BY units DESC, revenue DESC
     LIMIT ${Number(limit)}`,
    params(range),
  );
  return rows.map((r) => ({
    id: r.id as number,
    name: r.name as string,
    category: r.category as string,
    units: num(r.units),
    revenuePaise: num(r.revenue),
    profitPaise: num(r.profit),
  }));
}

// Physical cash taken at the counter, per staff member: every cash approval that was recorded
// (it is in payment_events), counted on the day it was approved. This includes an approval that
// ended as needs_review (paid too late, stock gone): the money is still in the drawer.
export async function cashByOperator(range: Range) {
  const { rows } = await pool.query(
    `SELECT u.id AS "operatorId", u.email, COALESCE(u.name, u.email) AS name, COUNT(*) AS approvals, SUM(pe.amount_paise) AS amount
       FROM payment_events pe
       JOIN users u ON u.id = pe.operator_id
      WHERE pe.source = 'cash'
        AND (pe.received_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
      GROUP BY u.id
      ORDER BY amount DESC`,
    params(range),
  );
  return rows.map((r) => ({
    operatorId: r.operatorId as number,
    email: r.email as string,
    name: r.name as string,
    approvals: num(r.approvals),
    amountPaise: num(r.amount),
  }));
}

export type Bill = {
  billNo: string; // BILL-000123
  orderId: string;
  date: string; // 22 Oct 2026 (India time)
  time: string; // 07:45 PM
  kioskCode: string;
  kioskName: string;
  items: string; // "Chips × 2, Cola × 1"
  quantity: number;
  amountPaise: number;
  paymentMode: "UPI" | "Cash" | "-";
  staff: string; // cash: who collected it; UPI: who was on duty at the kiosk
  status: "Paid" | "Collected";
  demo: boolean; // created by the demo-data script
};

// Every sale in the range, one row per bill, oldest first. Used by the PDF register.
export async function bills(range: Range): Promise<Bill[]> {
  const { rows } = await pool.query(
    `SELECT o.id, o.bill_no, o.status, o.total_paise,
            to_char(o.paid_at AT TIME ZONE $3, 'DD Mon YYYY') AS date,
            to_char(o.paid_at AT TIME ZONE $3, 'HH12:MI AM')  AS time,
            k.code AS kiosk_code, k.name AS kiosk_name,
            pay.source, pay.event_id,
            COALESCE(collector.name, collector.email) AS collector,
            COALESCE(agent.name, agent.email)         AS agent,
            lines.items, lines.quantity
       FROM orders o
       LEFT JOIN kiosks k ON k.id = o.kiosk_id
       -- the payment that paid this order (and, for cash, who took the money)
       LEFT JOIN LATERAL (
         SELECT pe.source, pe.operator_id, pe.event_id FROM payment_events pe
          WHERE pe.order_id = o.id AND pe.outcome = 'paid' ORDER BY pe.received_at LIMIT 1
       ) pay ON true
       LEFT JOIN users collector ON collector.id = pay.operator_id
       LEFT JOIN users agent ON agent.id = o.agent_user_id
       JOIN LATERAL (
         SELECT string_agg(p.name || ' × ' || oi.quantity, ', ' ORDER BY p.name) AS items,
                SUM(oi.quantity) AS quantity
           FROM order_items oi JOIN products p ON p.id = oi.product_id
          WHERE oi.order_id = o.id
       ) lines ON true
      WHERE o.status IN ('paid', 'claimed')
        AND (o.paid_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
      ORDER BY o.paid_at, o.bill_no`,
    params(range),
  );
  return rows.map((r) => ({
    billNo: `BILL-${String(r.bill_no).padStart(6, "0")}`,
    orderId: r.id,
    date: r.date,
    time: r.time,
    kioskCode: r.kiosk_code ?? "-",
    kioskName: r.kiosk_name ?? "",
    items: r.items,
    quantity: num(r.quantity),
    amountPaise: num(r.total_paise),
    paymentMode: r.source === "cash" ? "Cash" : r.source ? "UPI" : "-",
    staff: (r.source === "cash" ? r.collector : r.agent) ?? "-",
    status: r.status === "claimed" ? "Collected" : "Paid",
    demo: typeof r.event_id === "string" && r.event_id.startsWith("demo_"),
  }));
}
