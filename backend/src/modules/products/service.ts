import type { Db } from "../../db/db.js";

// Units that are promised to someone but not yet taken out of `stock`:
//   - unpaid orders whose 120s hold has not run out yet
//   - paid orders that have not been picked up yet
// clock_timestamp() is the real current time (now() would be frozen at the
// start of a transaction). Only the database clock is ever used.
export async function getHeldUnits(db: Db, productIds: number[]): Promise<Map<number, number>> {
  const { rows } = await db.query(
    `SELECT oi.product_id, SUM(oi.quantity)::int AS held
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.product_id = ANY($1)
        AND (o.status = 'paid'
             OR (o.status = 'pending' AND o.expires_at > clock_timestamp()))
      GROUP BY oi.product_id`,
    [productIds],
  );
  return new Map(rows.map((r) => [r.product_id as number, r.held as number]));
}

// available = stock - held. Same rule, written as one query for the whole list.
export async function listProducts(db: Db) {
  const { rows } = await db.query(
    `SELECT p.id,
            p.name,
            p.price_paise AS "pricePaise",
            p.stock,
            p.stock - COALESCE(h.held, 0) AS available
       FROM products p
       LEFT JOIN (
         SELECT oi.product_id, SUM(oi.quantity)::int AS held
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.status = 'paid'
             OR (o.status = 'pending' AND o.expires_at > clock_timestamp())
          GROUP BY oi.product_id
       ) h ON h.product_id = p.id
      ORDER BY p.id`,
  );
  return rows;
}
