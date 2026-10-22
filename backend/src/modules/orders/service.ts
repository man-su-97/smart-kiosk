import { withTransaction, pool } from "../../db/db.js";
import { config } from "../../config.js";
import { HttpError } from "../../errors.js";
import { getHeldUnits } from "../products/service.js";

type Item = { productId: number; quantity: number };

export async function createOrder(requested: Item[]) {
  // If the same product appears twice, add the quantities together.
  const wanted = new Map<number, number>();
  for (const { productId, quantity } of requested) {
    wanted.set(productId, (wanted.get(productId) ?? 0) + quantity);
  }
  // Sorted so every transaction locks products in the same order (no deadlocks).
  const productIds = [...wanted.keys()].sort((a, b) => a - b);

  const orderId = await withTransaction(async (tx) => {
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
      `INSERT INTO orders (status, total_paise, expires_at)
       VALUES ('pending', $1, clock_timestamp() + make_interval(secs => $2))
       RETURNING id`,
      [totalPaise, config.holdSeconds],
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
                 ELSE 0 END AS "expiresInSeconds"
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
    `UPDATE orders SET status = 'pending_cash_approval'
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
