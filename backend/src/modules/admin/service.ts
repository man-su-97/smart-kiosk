import { pool } from "../../db/db.js";
import { HttpError } from "../../errors.js";
import { payInternally } from "../payments/service.js";

// Cash orders waiting for the operator, oldest first, with what is in them.
export async function listCashRequests() {
  const { rows } = await pool.query(
    `SELECT o.id,
            o.total_paise AS "totalPaise",
            GREATEST(0, CEIL(EXTRACT(EPOCH FROM (o.expires_at - clock_timestamp()))))::int AS "expiresInSeconds",
            json_agg(json_build_object('name', p.name, 'quantity', oi.quantity) ORDER BY p.id) AS items
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.id
       JOIN products p ON p.id = oi.product_id
      WHERE o.status = 'pending_cash_approval' AND o.expires_at > clock_timestamp()
      GROUP BY o.id
      ORDER BY o.created_at`,
  );
  return rows;
}

async function statusOf(id: string): Promise<string> {
  const { rows } = await pool.query("SELECT status FROM orders WHERE id = $1", [id]);
  if (rows.length === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  return rows[0].status;
}

// Operator got the cash. Paying goes through the normal payment path (locks, idempotency,
// late-payment rule), so approving twice or after a UPI payment changes nothing.
export async function approveCash(id: string) {
  if ((await statusOf(id)) !== "pending_cash_approval") {
    throw new HttpError(409, "NOT_AWAITING_CASH", "Order is not waiting for cash");
  }
  return { result: await payInternally(id, "cash") };
}

// Operator did not get the money: cancel the order, which releases its held units.
export async function rejectCash(id: string) {
  const { rowCount } = await pool.query(
    "UPDATE orders SET status = 'cancelled' WHERE id = $1 AND status = 'pending_cash_approval'",
    [id],
  );
  if (rowCount === 0) {
    await statusOf(id); // throws 404 if unknown
    throw new HttpError(409, "NOT_AWAITING_CASH", "Order is not waiting for cash");
  }
  return { result: "cancelled" };
}
