import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import {
  addProduct, expireOrder, getOrderStatus, placeOrder, resetDb, sendWebhook, startApp, stopApp,
} from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

async function orderOf(productId: number, quantity: number) {
  return placeOrder(productId, quantity).then((r) => r.json());
}

describe("payment webhook", () => {
  it("rejects a wrong signature", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    const res = await sendWebhook({ eventId: "evt_1", orderId: order.id, amountPaise: 1500 }, "deadbeef");
    expect(res.status).toBe(401);
    expect(await getOrderStatus(order.id)).toBe("pending");
  });

  it("the same event sent twice is processed once", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    const event = { eventId: "evt_dup", orderId: order.id, amountPaise: 1500 };

    const first = await sendWebhook(event).then((r) => r.json());
    const second = await sendWebhook(event).then((r) => r.json());

    expect(first.result).toBe("paid");
    expect(second.result).toBe("duplicate");
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM payment_events WHERE event_id = 'evt_dup'");
    expect(rows[0].n).toBe(1);
  });

  it("the same event sent 5 times at once is processed once", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    const event = { eventId: "evt_race", orderId: order.id, amountPaise: 1500 };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => sendWebhook(event).then((r) => r.json())),
    );

    expect(results.filter((r) => r.result === "paid")).toHaveLength(1);
    expect(results.filter((r) => r.result === "duplicate")).toHaveLength(4);
    expect(await getOrderStatus(order.id)).toBe("paid");
  });

  it("rejects out-of-range or malformed payloads with 400 and records nothing", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    const bad = [
      { eventId: "evt_big", orderId: order.id, amountPaise: 3_000_000_000 }, // bigger than Postgres INTEGER
      { eventId: "evt_neg", orderId: order.id, amountPaise: -1 },
      { eventId: "x".repeat(200), orderId: order.id, amountPaise: 1500 },
      { eventId: "evt_status", orderId: order.id, amountPaise: 1500, status: "weird" },
    ];
    for (const event of bad) {
      expect((await sendWebhook(event)).status).toBe(400);
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM payment_events");
    expect(rows[0].n).toBe(0);
    expect(await getOrderStatus(order.id)).toBe("pending");
  });

  it("a wrong amount is not marked paid but needs_review", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    await sendWebhook({ eventId: "evt_amt", orderId: order.id, amountPaise: 1400 });
    expect(await getOrderStatus(order.id)).toBe("needs_review");
  });

  it("a non-captured event does not pay the order", async () => {
    const productId = await addProduct(3, 1500);
    const order = await orderOf(productId, 1);
    await sendWebhook({ eventId: "evt_fail", orderId: order.id, amountPaise: 1500, status: "failed" });
    expect(await getOrderStatus(order.id)).toBe("pending");
  });
});

describe("late payment (hold already expired)", () => {
  it("is accepted when the units are still free", async () => {
    const productId = await addProduct(1, 1500);
    const order = await orderOf(productId, 1);
    await expireOrder(order.id);

    await sendWebhook({ eventId: "evt_late1", orderId: order.id, amountPaise: 1500 });
    expect(await getOrderStatus(order.id)).toBe("paid");
  });

  it("goes to needs_review when someone else already took the units", async () => {
    const productId = await addProduct(1, 1500);
    const late = await orderOf(productId, 1);
    await expireOrder(late.id);
    const other = await orderOf(productId, 1); // second customer gets the last unit
    expect(other.id).toBeDefined();

    await sendWebhook({ eventId: "evt_late2", orderId: late.id, amountPaise: 1500 });

    expect(await getOrderStatus(late.id)).toBe("needs_review");
    const { rows } = await pool.query("SELECT review_reason FROM orders WHERE id = $1", [late.id]);
    expect(rows[0].review_reason).toBe("LATE_PAYMENT_STOCK_GONE");
  });
});
