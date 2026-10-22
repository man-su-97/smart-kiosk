import { pool, withTransaction, type Tx } from "../../db/db.js";
import { HttpError } from "../../errors.js";
import { getHeldUnits } from "../products/service.js";

export type WebhookEvent = {
  eventId: string;
  orderId: string;
  amountPaise: number;
  status: string;
};

export type WebhookResult =
  | "duplicate"
  | "order_not_found"
  | "ignored"
  | "already_paid"
  | "paid"
  | "needs_review";

// Payments that do not come from the bank webhook: the mock UPI page ("mockupi") and the
// operator approving cash ("cash"). They are turned into a normal captured event for the
// full order total, so they reuse the same locking, idempotency (one event id per order
// and source) and late-payment rules. The amount comes from the database, never the client.
export async function payInternally(orderId: string, source: "mockupi" | "cash"): Promise<WebhookResult> {
  const { rows } = await pool.query("SELECT total_paise FROM orders WHERE id = $1", [orderId]);
  if (rows.length === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  return processWebhook({
    eventId: `${source}_${orderId}`,
    orderId,
    amountPaise: rows[0].total_paise,
    status: "captured",
  });
}

export async function processWebhook(event: WebhookEvent): Promise<WebhookResult> {
  return withTransaction(async (tx) => {
    // Idempotency: record the event id first. If it already exists, a previous
    // call handled it, so do nothing. If two copies arrive at once, the second
    // INSERT waits for the first to commit and then also inserts nothing.
    const inserted = await tx.query(
      `INSERT INTO payment_events (event_id, order_id, status, amount_paise)
       VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING`,
      [event.eventId, event.orderId, event.status, event.amountPaise],
    );
    if (inserted.rowCount === 0) return "duplicate";

    // Lock the order so a webhook and a pickup (or two webhooks) cannot interleave.
    const { rows } = await tx.query(
      `SELECT id, status, total_paise, expires_at <= clock_timestamp() AS past_deadline
         FROM orders WHERE id = $1 FOR UPDATE`,
      [event.orderId],
    );
    if (rows.length === 0) return "order_not_found";
    const order = rows[0];

    if (event.status !== "captured") return "ignored";
    if (order.status === "paid" || order.status === "claimed") return "already_paid";
    if (order.status === "needs_review") return "ignored";

    // Wrong amount: do not trust it, a person must look.
    if (event.amountPaise !== order.total_paise) {
      await markNeedsReview(tx, order.id, "AMOUNT_MISMATCH");
      return "needs_review";
    }

    // Are this order's units still reserved for it? Only while it is unpaid and inside its
    // 120 s window. An expired or cancelled order has released them, so re-check the stock.
    const holdStillValid =
      (order.status === "pending" || order.status === "pending_cash_approval") && !order.past_deadline;
    if (!holdStillValid && !(await canStillFulfil(tx, order.id))) {
      // Money arrived but the units were sold to someone else meanwhile.
      await markNeedsReview(tx, order.id, "LATE_PAYMENT_STOCK_GONE");
      return "needs_review";
    }

    // Normal payment, or a late payment where the units are still free.
    await tx.query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1", [order.id]);
    return "paid";
  });
}

async function markNeedsReview(tx: Tx, id: string, reason: string) {
  await tx.query("UPDATE orders SET status = 'needs_review', review_reason = $2 WHERE id = $1", [
    id,
    reason,
  ]);
}

// For a late payment: are the units still free? Lock the products first, the same
// way createOrder does, so nobody can grab them while we check.
async function canStillFulfil(tx: Tx, orderId: string) {
  const { rows: items } = await tx.query(
    "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
    [orderId],
  );
  const ids = items.map((i) => i.product_id as number);
  const { rows: products } = await tx.query(
    "SELECT id, stock FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE",
    [ids],
  );
  // This order's hold is over (expired or cancelled), so it is not counted in `held`.
  const held = await getHeldUnits(tx, ids);
  return items.every((item) => {
    const stock = products.find((p) => p.id === item.product_id)!.stock as number;
    return stock - (held.get(item.product_id) ?? 0) >= item.quantity;
  });
}
