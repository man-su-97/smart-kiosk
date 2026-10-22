import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { api, addProduct, expireOrder, getOrderStatus, loginAs, placeOrder, resetDb, sendWebhook, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

async function cashOrder(stock = 3, quantity = 1) {
  const productId = await addProduct(stock, 1500);
  const order = await placeOrder(productId, quantity).then((r) => r.json());
  await api(`/orders/${order.id}/cash-request`, { method: "POST" });
  return { productId, orderId: order.id as string };
}
const approve = (orderId: string, headers: Record<string, string>) =>
  api(`/admin/orders/${orderId}/approve-cash`, { method: "POST", headers });
const reject = (orderId: string, headers: Record<string, string>) =>
  api(`/admin/orders/${orderId}/reject-cash`, { method: "POST", headers });
const events = () => pool.query("SELECT * FROM payment_events ORDER BY received_at").then((r) => r.rows);

describe("cash log", () => {
  it("an approval records who took how much cash for which order", async () => {
    const staff = await loginAs("staff");
    const { orderId } = await cashOrder(3, 2);

    expect((await approve(orderId, staff.headers).then((r) => r.json())).result).toBe("paid");

    const [event] = await events();
    expect(event).toMatchObject({
      event_id: `cash_${orderId}`,
      order_id: orderId,
      source: "cash",
      operator_id: staff.user.id,
      amount_paise: 3000,
      outcome: "paid",
    });
  });

  it("webhook and mock-UPI payments are logged with their source and no operator", async () => {
    const productId = await addProduct(5, 1500);
    const a = await placeOrder(productId, 1).then((r) => r.json());
    const b = await placeOrder(productId, 1).then((r) => r.json());
    await sendWebhook({ eventId: "evt_a", orderId: a.id, amountPaise: 1500 });
    await api("/payments/mock-success", { method: "POST", body: { orderId: b.id } });

    const rows = await events();
    expect(rows.map((e) => [e.source, e.operator_id, e.outcome])).toEqual([
      ["webhook", null, "paid"],
      ["mockupi", null, "paid"],
    ]);
  });

  it("two staff approving at the same moment: one payment, one log row", async () => {
    const [anna, ben] = [await loginAs("staff", "anna@test.local"), await loginAs("staff", "ben@test.local")];
    const { orderId } = await cashOrder();

    const results = await Promise.all([approve(orderId, anna.headers), approve(orderId, ben.headers)]).then((rs) =>
      Promise.all(rs.map((r) => r.json())),
    );

    expect(results.map((r) => r.result).sort()).toEqual(["duplicate", "paid"]);
    const rows = await events();
    expect(rows).toHaveLength(1);
    expect([anna.user.id, ben.user.id]).toContain(rows[0].operator_id);
  });

  it("approve and reject at the same moment: never both", async () => {
    const staff = await loginAs("staff");
    for (let round = 0; round < 10; round++) {
      const { orderId } = await cashOrder();

      const [approved, rejected] = await Promise.all([approve(orderId, staff.headers), reject(orderId, staff.headers)]);
      const status = await getOrderStatus(orderId);
      const logged = (await pool.query("SELECT 1 FROM payment_events WHERE order_id = $1", [orderId])).rowCount;

      if (status === "paid") {
        // Approve won: reject saw it was no longer waiting.
        expect([approved.status, rejected.status]).toEqual([200, 409]);
        expect(logged).toBe(1);
      } else {
        // Reject won: approve was refused under the lock and nothing was logged.
        expect(status).toBe("cancelled");
        expect([approved.status, rejected.status]).toEqual([409, 200]);
        expect(logged).toBe(0);
      }
    }
  });

  it("a late approval that cannot be fulfilled still counts as cash taken", async () => {
    const staff = await loginAs("staff");
    const { productId, orderId } = await cashOrder(1, 1);
    await expireOrder(orderId); // hold ran out while the customer was at the counter
    await placeOrder(productId, 1); // someone else took the unit

    expect((await approve(orderId, staff.headers).then((r) => r.json())).result).toBe("needs_review");
    const [event] = await events();
    expect(event).toMatchObject({ source: "cash", operator_id: staff.user.id, outcome: "needs_review" });
  });
});
