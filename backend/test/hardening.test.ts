import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool, withTransaction } from "../src/db/db.js";
import {
  addProduct, getOrderStatus, getProducts, placeOrder, resetDb, sendWebhook, startApp, stopApp,
} from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("webhook at the 120 s deadline", () => {
  // Forces the dangerous interleaving with a real lock instead of hoping for lucky timing:
  // a "createOrder" is holding the product row while the deadline passes.
  it("waits for in-flight product locks, then decides with the clock it sees after them", async () => {
    const productId = await addProduct(1, 1500);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    await pool.query(
      "UPDATE orders SET expires_at = clock_timestamp() + interval '700 milliseconds' WHERE id = $1",
      [order.id],
    );

    // Stand-in for a createOrder that has locked the product and is still deciding.
    const other = await pool.connect();
    let webhook: Promise<{ result: string }> | undefined;
    try {
      await other.query("BEGIN");
      await other.query("SELECT id FROM products WHERE id = $1 FOR UPDATE", [productId]);

      // The payment arrives while the hold is still valid...
      let settled = false;
      webhook = sendWebhook({ eventId: "evt_deadline_race", orderId: order.id, amountPaise: 1500 })
        .then((r) => r.json())
        .finally(() => (settled = true));

      // ...and must wait for the product lock instead of marking the order paid right away.
      await sleep(300);
      expect(settled).toBe(false);

      // Meanwhile the deadline passes and the other customer takes the (now released) unit.
      await sleep(600);
      const { rows } = await other.query(
        `INSERT INTO orders (status, total_paise, expires_at)
         VALUES ('pending', 1500, clock_timestamp() + interval '120 seconds') RETURNING id`,
      );
      await other.query(
        "INSERT INTO order_items (order_id, product_id, quantity, unit_price_paise) VALUES ($1, $2, 1, 1500)",
        [rows[0].id, productId],
      );
      await other.query("COMMIT");
    } finally {
      // If an assertion above failed, do not leave the product locked for the next tests.
      await other.query("ROLLBACK").catch(() => {});
      other.release();
      await webhook?.catch(() => {});
    }

    // Now the webhook gets the lock, sees the deadline has passed and the unit is gone.
    expect((await webhook!).result).toBe("needs_review");
    expect(await getOrderStatus(order.id)).toBe("needs_review");
    expect((await getProducts())[0].available).toBe(0); // 1 in stock, 1 held: never sold twice
  });
});

describe("database connection failures", () => {
  it("the pool has an error listener, so a dropped idle connection cannot crash the process", () => {
    expect(pool.listenerCount("error")).toBeGreaterThan(0);
  });

  it("a connection killed mid-transaction surfaces the real error and the pool keeps working", async () => {
    await expect(
      withTransaction(async (tx) => {
        const { rows } = await tx.query("SELECT pg_backend_pid() AS pid");
        await pool.query("SELECT pg_terminate_backend($1)", [rows[0].pid]); // kill our own connection
        await tx.query("SELECT 1");
      }),
    ).rejects.toThrow(/terminat/i); // not a confusing "ROLLBACK failed" error

    // The dead client was thrown away, not handed to the next caller.
    for (let i = 0; i < 25; i++) {
      expect((await pool.query("SELECT 1 AS ok")).rows[0].ok).toBe(1);
    }
  });
});
