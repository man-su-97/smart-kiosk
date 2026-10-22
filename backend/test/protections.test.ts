import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { config, paymentSimulatorAllowed } from "../src/config.js";
import { pool } from "../src/db/db.js";
import { hasRealSales, seedDemoData } from "../src/modules/demo/seedDemo.js";
import { publicOnlyLookup } from "../src/modules/images/fetchImage.js";
import { addProduct, api, baseUrl, getOrderStatus, getProducts, loginAs, placeOrder, resetDb, sendWebhook, startApp, stopApp } from "./helpers.js";

// One test per way the business could lose money or stock (see README "Security & business-loss checks").

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);
const saved = { ...config };
afterEach(() => Object.assign(config, saved));

const ageExpiry = (orderId: string, minutesAgo: number) =>
  pool.query("UPDATE orders SET expires_at = now() - make_interval(mins => $2) WHERE id = $1", [orderId, minutesAgo]);

describe("free goods", () => {
  it("the payment simulator is off in production unless explicitly allowed", () => {
    expect(paymentSimulatorAllowed({ ENABLE_PAYMENT_SIMULATOR: "true" })).toBe(true); // local dev
    expect(paymentSimulatorAllowed({ ENABLE_PAYMENT_SIMULATOR: "true", NODE_ENV: "production" })).toBe(false);
    expect(paymentSimulatorAllowed({ ENABLE_PAYMENT_SIMULATOR: "true", NODE_ENV: "production", ALLOW_SIMULATOR_IN_PRODUCTION: "true" })).toBe(true);
    expect(paymentSimulatorAllowed({ NODE_ENV: "production", ALLOW_SIMULATOR_IN_PRODUCTION: "true" })).toBe(false);
  });

  it("only the locker (with its key) can claim a paid order", async () => {
    const productId = await addProduct(3, 1500);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    await sendWebhook({ eventId: "evt_lock", orderId: order.id, amountPaise: 1500 });
    const claim = (headers: Record<string, string>) => fetch(`${baseUrl()}/orders/${order.id}/pickup-claim`, { method: "POST", headers });

    expect((await claim({})).status).toBe(401);
    expect((await claim({ "X-Locker-Key": "test-locker-kez" })).status).toBe(401); // same length, wrong
    expect(await getOrderStatus(order.id)).toBe("paid");
    expect((await claim({ "X-Locker-Key": process.env.LOCKER_KEY! })).status).toBe(200);
  });
});

describe("stock abuse", () => {
  it("one client cannot keep more than N unpaid holds open", async () => {
    config.maxOpenHoldsPerClient = 2;
    const productId = await addProduct(10, 1000);
    const first = await placeOrder(productId, 1).then((r) => r.json());
    expect((await placeOrder(productId, 1)).status).toBe(201);
    const third = await placeOrder(productId, 1);
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe("TOO_MANY_OPEN_ORDERS");
    expect((await getProducts())[0].available).toBe(8); // the rest is still for sale

    await ageExpiry(first.id, 1); // one hold ran out: room for one more
    expect((await placeOrder(productId, 1)).status).toBe(201);
  });

  it("the limit holds even when the requests arrive at the same moment", async () => {
    config.maxOpenHoldsPerClient = 3;
    const productId = await addProduct(20, 1000);
    const results = await Promise.all(Array.from({ length: 10 }, () => placeOrder(productId, 1)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 429)).toHaveLength(7);
  });

  it("limits how many orders one client can place in 10 minutes", async () => {
    config.maxOrdersPerClientPer10Min = 3;
    const productId = await addProduct(20, 1000);
    for (let i = 0; i < 3; i++) {
      const order = await placeOrder(productId, 1).then((r) => r.json());
      await ageExpiry(order.id, 1); // not open any more, but still counts as recent
    }
    const res = await placeOrder(productId, 1);
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("TOO_MANY_ORDERS");
  });

  it("the 50-per-product limit also applies after repeated lines are added up", async () => {
    const productId = await addProduct(200, 1000);
    const twice = await api("/orders", { method: "POST", body: { items: [{ productId, quantity: 40 }, { productId, quantity: 40 }] } });
    expect(twice.status).toBe(400);
    expect((await api("/orders", { method: "POST", body: { items: [{ productId, quantity: 25 }, { productId, quantity: 25 }] } })).status).toBe(201);
  });
});

describe("money", () => {
  it("a second payment for a paid order is flagged and listed for the admin", async () => {
    const admin = (await loginAs("admin")).headers;
    const productId = await addProduct(3, 1500);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    expect((await sendWebhook({ eventId: "evt_first", orderId: order.id, amountPaise: 1500 }).then((r) => r.json())).result).toBe("paid");
    expect((await sendWebhook({ eventId: "evt_second", orderId: order.id, amountPaise: 1500 }).then((r) => r.json())).result).toBe("duplicate_payment");
    expect((await sendWebhook({ eventId: "evt_second", orderId: order.id, amountPaise: 1500 }).then((r) => r.json())).result).toBe("duplicate"); // repeat of it

    const attention = await api("/admin/attention", { headers: admin }).then((r) => r.json());
    expect(attention).toEqual([expect.objectContaining({ kind: "paid_twice", orderId: order.id, amountPaise: 1500, detail: "UPI" })]);
    expect((await api("/admin/attention", { headers: (await loginAs("staff")).headers })).status).toBe(403);
  });

  it("staff are told not to take cash for an order already paid by UPI", async () => {
    const staff = (await loginAs("staff")).headers;
    const productId = await addProduct(3, 1500);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    await api(`/orders/${order.id}/cash-request`, { method: "POST" });
    await sendWebhook({ eventId: "evt_upi", orderId: order.id, amountPaise: 1500 });

    const res = await api(`/admin/orders/${order.id}/approve-cash`, { method: "POST", headers: staff });
    expect(res.status).toBe(409);
    expect((await res.json()).message).toMatch(/already paid/i);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM payment_events WHERE source = 'cash'");
    expect(rows[0].n).toBe(0); // nothing recorded as cash taken
  });

  it("cash handed over just before the hold ran out can be approved for 10 minutes", async () => {
    const staff = (await loginAs("staff")).headers;
    const productId = await addProduct(3, 1500);
    const late = await placeOrder(productId, 1).then((r) => r.json());
    await api(`/orders/${late.id}/cash-request`, { method: "POST" });
    await ageExpiry(late.id, 2);
    await pool.query("UPDATE orders SET status = 'expired' WHERE id = $1", [late.id]); // the background job ran

    const queue = await api("/admin/cash-requests", { headers: staff }).then((r) => r.json());
    expect(queue).toEqual([expect.objectContaining({ id: late.id, late: true })]);
    expect((await api(`/orders/${late.id}`).then((r) => r.json())).cashRequested).toBe(true);
    expect((await api(`/admin/orders/${late.id}/approve-cash`, { method: "POST", headers: staff }).then((r) => r.json())).result).toBe("paid");
  });

  it("…but not after the grace window, and never for orders that did not ask for cash", async () => {
    const staff = (await loginAs("staff")).headers;
    const productId = await addProduct(3, 1500);
    const tooLate = await placeOrder(productId, 1).then((r) => r.json());
    await api(`/orders/${tooLate.id}/cash-request`, { method: "POST" });
    await ageExpiry(tooLate.id, config.cashGraceMinutes + 1);
    expect(await api("/admin/cash-requests", { headers: staff }).then((r) => r.json())).toEqual([]);
    expect((await api(`/admin/orders/${tooLate.id}/approve-cash`, { method: "POST", headers: staff })).status).toBe(409);

    const upiOrder = await placeOrder(productId, 1).then((r) => r.json()); // never asked for cash
    expect((await api(`/admin/orders/${upiOrder.id}/approve-cash`, { method: "POST", headers: staff })).status).toBe(409);
  });

  it("switching to cash only accepts JSON (blocks hidden forms on other websites)", async () => {
    const productId = await addProduct(3, 1500);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    const form = await fetch(`${baseUrl()}/orders/${order.id}/cash-request`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "x=1",
    });
    expect(form.status).toBe(415);
    expect(await getOrderStatus(order.id)).toBe("pending");
  });
});

describe("other", () => {
  it("image downloads cannot connect to private addresses, even if DNS changes its answer", async () => {
    const lookupResult = await new Promise<{ err: NodeJS.ErrnoException | null }>((resolve) =>
      publicOnlyLookup("localhost", { all: true }, (err) => resolve({ err })),
    );
    expect(lookupResult.err?.code).toBe("EBLOCKED");
  });

  it("sample data is not added on start-up once real sales exist", async () => {
    expect(await hasRealSales()).toBe(false);
    const productId = await addProduct(3, 1500);
    await seedDemoData({ days: 1 }); // sample payments do not count as real
    expect(await hasRealSales()).toBe(false);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    await sendWebhook({ eventId: "evt_real", orderId: order.id, amountPaise: 1500 });
    expect(await hasRealSales()).toBe(true);
  });
});
