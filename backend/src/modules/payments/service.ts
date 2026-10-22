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
  "duplicate" | "order_not_found" | "ignored" | "already_paid" | "paid" | "needs_review";

export type PaymentOptions = {
  source?: "webhook" | "mockupi" | "cash";
  operatorId?: number; // the staff member who took the cash
  requireStatus?: string; // only pay if the order is in this status (checked under the lock)
};

// Payments that do not come from the bank webhook: the mock UPI page ("mockupi") and staff
// approving cash ("cash"). They are turned into a normal captured event for the full order
// total, so they reuse the same locking, idempotency (one event id per order and source) and
// late-payment rules. The amount comes from the database, never the client.
export async function payInternally(
  orderId: string,
  source: "mockupi" | "cash",
  options: Omit<PaymentOptions, "source"> = {},
): Promise<WebhookResult> {
  const { rows } = await pool.query("SELECT total_paise FROM orders WHERE id = $1", [orderId]);
  if (rows.length === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  return processWebhook(
    {
      eventId: `${source}_${orderId}`,
      orderId,
      amountPaise: rows[0].total_paise,
      status: "captured",
    },
    { ...options, source },
  );
}

export async function processWebhook(
  event: WebhookEvent,
  options: PaymentOptions = {},
): Promise<WebhookResult> {
  return withTransaction(async (tx) => {
    // Idempotency: record the event id first. If it already exists, a previous
    // call handled it, so do nothing. If two copies arrive at once, the second
    // INSERT waits for the first to commit and then also inserts nothing.
    // The same row is the cash log: source = 'cash' and operator_id = who took the money,
    // written in this transaction, so the log and the payment can never disagree.
    const inserted = await tx.query(
      `INSERT INTO payment_events (event_id, order_id, status, amount_paise, source, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
      [
        event.eventId,
        event.orderId,
        event.status,
        event.amountPaise,
        options.source ?? "webhook",
        options.operatorId ?? null,
      ],
    );
    if (inserted.rowCount === 0) return "duplicate";

    const result = await applyPayment(tx, event, options);
    // Audit trail: what this event did.
    await tx.query("UPDATE payment_events SET outcome = $2 WHERE event_id = $1", [event.eventId, result]);
    return result;
  });
}

async function applyPayment(tx: Tx, event: WebhookEvent, options: PaymentOptions): Promise<WebhookResult> {
  // Lock the order so a webhook and a pickup (or two webhooks) cannot interleave.
  const { rows } = await tx.query("SELECT id, status, total_paise FROM orders WHERE id = $1 FOR UPDATE", [
    event.orderId,
  ]);
  if (rows.length === 0) return "order_not_found";
  const order = rows[0];

  // Checked here, under the lock, not before: otherwise "approve" could read
  // pending_cash_approval, a "reject" could commit, and we would then pay a cancelled order.
  // Throwing rolls back the event row too, so nothing is logged.
  if (options.requireStatus && order.status !== options.requireStatus) {
    throw new HttpError(409, "WRONG_STATUS", `Order is ${order.status}, not ${options.requireStatus}`);
  }

  if (event.status !== "captured") return "ignored";
  if (order.status === "paid" || order.status === "claimed") return "already_paid";
  if (order.status === "needs_review") return "ignored";

  // Wrong amount: do not trust it, a person must look.
  if (event.amountPaise !== order.total_paise) {
    await markNeedsReview(tx, order.id, "AMOUNT_MISMATCH");
    return "needs_review";
  }

  // Lock this order's products BEFORE looking at the clock. createOrder decides "is that
  // hold expired?" while holding these same locks, so we must decide while holding them too.
  // Otherwise: we check at 119.999 s ("still valid"), a new order locks the products at
  // 120.001 s, sees our order as expired and takes the units, then we commit "paid": sold twice.
  // Lock order is always order -> products (same as claimPickup), so no deadlock.
  const { items, products } = await lockProductsOf(tx, order.id);
  const { rows: deadline } = await tx.query(
    "SELECT expires_at <= clock_timestamp() AS past FROM orders WHERE id = $1",
    [order.id],
  );

  // Are this order's units still reserved for it? Only while it is unpaid and inside its
  // 120 s window. An expired or cancelled order has released them, so re-check the stock.
  const holdStillValid =
    (order.status === "pending" || order.status === "pending_cash_approval") && !deadline[0].past;
  if (!holdStillValid && !(await canStillFulfil(tx, items, products))) {
    // Money arrived but the units were sold to someone else meanwhile.
    await markNeedsReview(tx, order.id, "LATE_PAYMENT_STOCK_GONE");
    return "needs_review";
  }

  // Normal payment, or a late payment where the units are still free.
  await tx.query("UPDATE orders SET status = 'paid', paid_at = now() WHERE id = $1", [order.id]);
  return "paid";
}

async function markNeedsReview(tx: Tx, id: string, reason: string) {
  await tx.query("UPDATE orders SET status = 'needs_review', review_reason = $2 WHERE id = $1", [id, reason]);
}

type Item = { product_id: number; quantity: number };
type LockedProduct = { id: number; stock: number };

// Lock the order's product rows, sorted by id like createOrder, and return them.
async function lockProductsOf(tx: Tx, orderId: string) {
  const { rows: items } = await tx.query<Item>(
    "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
    [orderId],
  );
  const { rows: products } = await tx.query<LockedProduct>(
    "SELECT id, stock FROM products WHERE id = ANY($1) ORDER BY id FOR UPDATE",
    [items.map((i) => i.product_id)],
  );
  return { items, products };
}

// For a late payment: are the units still free? The product rows are already locked,
// so nobody can grab them while we check.
async function canStillFulfil(tx: Tx, items: Item[], products: LockedProduct[]) {
  // This order's hold is over (expired or cancelled), so it is not counted in `held`.
  const held = await getHeldUnits(
    tx,
    items.map((i) => i.product_id),
  );
  return items.every((item) => {
    const stock = products.find((p) => p.id === item.product_id)!.stock as number;
    return stock - (held.get(item.product_id) ?? 0) >= item.quantity;
  });
}
