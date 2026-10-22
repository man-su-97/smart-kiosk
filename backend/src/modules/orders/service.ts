import { withTransaction, pool, type Tx } from "../../db/db.js";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { getHeldUnits } from "../products/service.js";

type Item = { productId: number; quantity: number };

const MAX_PER_PRODUCT = 50;

// Stops one client (e.g. a script) holding all the stock so real customers see "Sold out".
// The advisory lock makes requests from the same IP take turns, so ten at once cannot all
// pass the count before any of them is saved. 0 in config = no limit.
async function checkClientLimits(tx: Tx, clientIp: string) {
  if (!config.maxOpenHoldsPerClient && !config.maxOrdersPerClientPer10Min) return;
  await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`orders:${clientIp}`]);
  const { rows } = await tx.query(
    `SELECT count(*) FILTER (WHERE status IN ('pending', 'pending_cash_approval') AND expires_at > clock_timestamp()) AS open_holds,
            count(*) FILTER (WHERE created_at > now() - interval '10 minutes') AS recent
       FROM orders WHERE client_ip = $1`,
    [clientIp],
  );
  const openHolds = Number(rows[0].open_holds);
  const recent = Number(rows[0].recent);
  if (config.maxOpenHoldsPerClient && openHolds >= config.maxOpenHoldsPerClient) {
    throw new HttpError(429, "TOO_MANY_OPEN_ORDERS", "Too many unpaid orders from this device. Pay or wait for one to expire.");
  }
  if (config.maxOrdersPerClientPer10Min && recent >= config.maxOrdersPerClientPer10Min) {
    throw new HttpError(429, "TOO_MANY_ORDERS", "Too many orders from this device. Please try again in a few minutes.");
  }
}

export async function createOrder(requested: Item[], kioskCode?: string, clientIp = "unknown") {
  // If the same product appears twice, add the quantities together.
  const wanted = new Map<number, number>();
  for (const { productId, quantity } of requested) {
    wanted.set(productId, (wanted.get(productId) ?? 0) + quantity);
  }
  // The 50 limit is per product, so it also applies after repeated lines are added up.
  for (const quantity of wanted.values()) {
    if (quantity > MAX_PER_PRODUCT) throw new HttpError(400, "TOO_MANY", `At most ${MAX_PER_PRODUCT} of one product per order`);
  }
  // Sorted so every transaction locks products in the same order (no deadlocks).
  const productIds = [...wanted.keys()].sort((a, b) => a - b);

  const orderId = await withTransaction(async (tx) => {
    await checkClientLimits(tx, clientIp);

    // Lock the product rows. A second buyer of the same product waits here until
    // we commit, then sees our hold when it counts. This is what stops overselling.
    const { rows: products } = await tx.query(
      `SELECT id, price_paise, cost_paise, stock, active FROM products
        WHERE id = ANY($1) ORDER BY id FOR UPDATE`,
      [productIds],
    );
    // Hidden (inactive) products cannot be bought, same as products that do not exist.
    if (products.length !== productIds.length || products.some((p) => !p.active)) {
      throw new HttpError(400, "UNKNOWN_PRODUCT", "One or more products do not exist");
    }

    // Which kiosk is selling, and which staff member is on duty there right now (from the roster);
    // both are saved on the order for the bill. No code = the first kiosk, so a single-kiosk
    // setup needs no configuration. The roster allows at most one person per kiosk at a time.
    const { rows: kiosks } = await tx.query(
      `SELECT k.id,
              (SELECT s.user_id FROM kiosk_shifts s
                WHERE s.kiosk_id = k.id AND tstzrange(s.starts_at, s.ends_at) @> clock_timestamp()) AS agent_user_id
         FROM kiosks k
        WHERE k.active AND ($1::text IS NULL OR k.code = $1)
        ORDER BY k.id
        LIMIT 1`,
      [kioskCode ?? null],
    );
    if (kioskCode && kiosks.length === 0) throw new HttpError(400, "UNKNOWN_KIOSK", `No kiosk with code ${kioskCode}`);
    const kiosk = kiosks[0] ?? { id: null, agent_user_id: null };

    const held = await getHeldUnits(tx, productIds);
    const shortages: { productId: number; requested: number; available: number }[] = [];
    let totalPaise = 0;
    for (const p of products) {
      const quantity = wanted.get(p.id)!;
      const available = p.stock - (held.get(p.id) ?? 0);
      if (quantity > available) shortages.push({ productId: p.id, requested: quantity, available });
      totalPaise += quantity * p.price_paise;
    }
    // Throwing rolls the transaction back, so nothing is held.
    if (shortages.length > 0) {
      throw new HttpError(409, "INSUFFICIENT_STOCK", "Not enough stock", { shortages });
    }

    const { rows } = await tx.query(
      `INSERT INTO orders (status, total_paise, expires_at, kiosk_id, agent_user_id, client_ip)
       VALUES ('pending', $1, clock_timestamp() + make_interval(secs => $2), $3, $4, $5)
       RETURNING id`,
      [totalPaise, config.holdSeconds, kiosk.id, kiosk.agent_user_id, clientIp],
    );
    const id: string = rows[0].id;
    for (const p of products) {
      await tx.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise, unit_cost_paise)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, p.id, wanted.get(p.id), p.price_paise, p.cost_paise],
      );
    }
    return id;
  });

  return getOrder(orderId);
}

// Seconds left are measured by the database at the moment of this query, so the
// browser never has to compare its own clock with ours.
export async function getOrder(id: string) {
  const { rows } = await pool.query(
    `SELECT id,
            total_paise AS "totalPaise",
            review_reason AS "reviewReason",
            -- A pending order past its deadline counts as expired, even before
            -- the background job gets around to updating the row.
            CASE WHEN status IN ('pending', 'pending_cash_approval') AND expires_at <= clock_timestamp()
                 THEN 'expired' ELSE status END AS status,
            CASE WHEN status IN ('pending', 'pending_cash_approval')
                 THEN GREATEST(0, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp()))))::int
                 ELSE 0 END AS "expiresInSeconds",
            cash_requested_at IS NOT NULL AS "cashRequested"
       FROM orders WHERE id = $1`,
    [id],
  );
  if (rows.length === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
  return rows[0];
}

// Customer chose "Pay with cash". The order keeps its hold and waits for the operator.
// Only a pending order inside its window can switch; asking twice is harmless.
export async function requestCash(id: string) {
  const { rowCount } = await pool.query(
    `UPDATE orders SET status = 'pending_cash_approval', cash_requested_at = now()
      WHERE id = $1 AND status = 'pending' AND expires_at > clock_timestamp()`,
    [id],
  );
  const order = await getOrder(id); // 404 if it does not exist
  if (rowCount === 0 && order.status !== "pending_cash_approval") {
    throw new HttpError(409, "NOT_PENDING", `Order is ${order.status}, cannot pay by cash`);
  }
  return order;
}

export async function claimPickup(id: string) {
  return withTransaction(async (tx) => {
    // Only one caller can flip paid -> claimed. A second caller waits for the
    // first to commit, then finds status = 'claimed', matches 0 rows, and gets 409.
    const { rowCount } = await tx.query(
      `UPDATE orders SET status = 'claimed', claimed_at = now()
        WHERE id = $1 AND status = 'paid'`,
      [id],
    );
    if (rowCount === 0) {
      const { rows } = await tx.query("SELECT status FROM orders WHERE id = $1", [id]);
      if (rows.length === 0) throw new HttpError(404, "ORDER_NOT_FOUND", "Order not found");
      throw new HttpError(409, "NOT_CLAIMABLE", `Order is ${rows[0].status}, cannot be claimed`);
    }

    // The sale is final: take the units out of stock for good.
    // Sorted by product so two claims never lock rows in opposite order.
    const { rows: items } = await tx.query(
      "SELECT product_id, quantity FROM order_items WHERE order_id = $1 ORDER BY product_id",
      [id],
    );
    for (const item of items) {
      await tx.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [
        item.quantity,
        item.product_id,
      ]);
    }
    return { id, status: "claimed" };
  });
}
