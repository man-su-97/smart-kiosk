import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config } from "../src/config.js";
import {
  addProduct, baseUrl, claim, expireOrder, getOrderStatus, getProducts, loginAs, placeOrder, resetDb, startApp,
  stopApp,
} from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

// The cash queue needs a staff login (session cookie). Fresh database and login per test.
let ADMIN: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  ADMIN = (await loginAs("staff")).headers;
});

const post = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function newOrder(stock = 3, quantity = 1) {
  const productId = await addProduct(stock, 1500);
  const order = await placeOrder(productId, quantity).then((r) => r.json());
  return { productId, orderId: order.id as string };
}

describe("mock UPI (phone page / simulate button)", () => {
  it("marks the order paid; a second tap changes nothing", async () => {
    const { orderId } = await newOrder();
    expect((await post("/payments/mock-success", { orderId }).then((r) => r.json())).result).toBe("paid");
    expect((await post("/payments/mock-success", { orderId }).then((r) => r.json())).result).toBe("duplicate");
    expect(await getOrderStatus(orderId)).toBe("paid");
  });

  it("is refused (404) and pays nothing when the simulator is off", async () => {
    const { orderId } = await newOrder();
    config.paymentSimulator = false;
    const res = await post("/payments/mock-success", { orderId });
    config.paymentSimulator = true;
    expect(res.status).toBe(404);
    expect(await getOrderStatus(orderId)).toBe("pending");
  });
});

describe("cash: customer requests, operator approves or rejects", () => {
  it("cash request keeps the hold and waits for the operator", async () => {
    const { orderId } = await newOrder(3, 2);
    const res = await post(`/orders/${orderId}/cash-request`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("pending_cash_approval");
    expect((await getProducts())[0].available).toBe(1); // 3 in stock, 2 still held
    // Asking twice is harmless.
    expect((await post(`/orders/${orderId}/cash-request`)).status).toBe(200);
  });

  it("an expired order cannot switch to cash", async () => {
    const { orderId } = await newOrder();
    await expireOrder(orderId);
    expect((await post(`/orders/${orderId}/cash-request`)).status).toBe(409);
  });

  it("cash queue endpoints need a staff login", async () => {
    const { orderId } = await newOrder();
    await post(`/orders/${orderId}/cash-request`);
    expect((await fetch(`${baseUrl()}/admin/cash-requests`)).status).toBe(401);
    expect((await post(`/admin/orders/${orderId}/approve-cash`, undefined, { Cookie: "sid=made-up" })).status).toBe(401);
    expect(await getOrderStatus(orderId)).toBe("pending_cash_approval");
  });

  it("the operator sees the request, approves it, the order is paid and can be picked up once", async () => {
    const { orderId } = await newOrder(3, 2);
    await post(`/orders/${orderId}/cash-request`);

    const list = await fetch(`${baseUrl()}/admin/cash-requests`, { headers: ADMIN }).then((r) => r.json());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: orderId, totalPaise: 3000, items: [{ name: "Test snack", quantity: 2 }] });

    const approved = await post(`/admin/orders/${orderId}/approve-cash`, undefined, ADMIN).then((r) => r.json());
    expect(approved.result).toBe("paid");
    expect(await getOrderStatus(orderId)).toBe("paid");

    // Approving again changes nothing (same event id: duplicate), and only one pickup succeeds.
    expect((await post(`/admin/orders/${orderId}/approve-cash`, undefined, ADMIN).then((r) => r.json())).result).toBe("duplicate");
    const claims = await Promise.all([claim(orderId), claim(orderId)]);
    expect(claims.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("two operators approving at the same moment: paid once", async () => {
    const { orderId } = await newOrder();
    await post(`/orders/${orderId}/cash-request`);
    const results = await Promise.all([
      post(`/admin/orders/${orderId}/approve-cash`, undefined, ADMIN).then((r) => r.json()),
      post(`/admin/orders/${orderId}/approve-cash`, undefined, ADMIN).then((r) => r.json()),
    ]);
    // One pays; the other either sees a duplicate event or that it is no longer waiting.
    expect(results.filter((r) => r.result === "paid")).toHaveLength(1);
    expect(await getOrderStatus(orderId)).toBe("paid");
  });

  it("rejecting cancels the order and releases its units", async () => {
    const { orderId } = await newOrder(3, 2);
    await post(`/orders/${orderId}/cash-request`);
    expect((await getProducts())[0].available).toBe(1);

    const res = await post(`/admin/orders/${orderId}/reject-cash`, undefined, ADMIN);
    expect(res.status).toBe(200);
    expect(await getOrderStatus(orderId)).toBe("cancelled");
    expect((await getProducts())[0].available).toBe(3);
  });

  it("a UPI payment for a cancelled order re-checks stock instead of trusting the old hold", async () => {
    const { productId, orderId } = await newOrder(1, 1);
    await post(`/orders/${orderId}/cash-request`);
    await post(`/admin/orders/${orderId}/reject-cash`, undefined, ADMIN);
    await placeOrder(productId, 1); // someone else takes the only unit

    await post("/payments/mock-success", { orderId });
    expect(await getOrderStatus(orderId)).toBe("needs_review"); // never oversold
  });
});
