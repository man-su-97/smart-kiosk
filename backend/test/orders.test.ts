import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addProduct, expireOrder, getProducts, placeOrder, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

describe("placing orders under pressure", () => {
  it("ten customers want the last 2 units: exactly 2 succeed, 8 fail cleanly", async () => {
    const productId = await addProduct(2);

    const responses = await Promise.all(Array.from({ length: 10 }, () => placeOrder(productId, 1)));
    const statuses = responses.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(2);
    expect(statuses.filter((s) => s === 409)).toHaveLength(8);

    const failed = await responses.find((r) => r.status === 409)!.json();
    expect(failed.error).toBe("INSUFFICIENT_STOCK");

    const [product] = await getProducts();
    expect(product.stock).toBe(2);
    expect(product.available).toBe(0); // exactly 2 units held, never negative
  });

  // One round of a race can pass by luck (requests may happen to run one after
  // another), so repeat it: without the row lock this fails within a few rounds.
  it("repeated races: 20 buyers, 2 units, 15 rounds, never oversold", async () => {
    for (let round = 0; round < 15; round++) {
      await resetDb();
      const productId = await addProduct(2);

      const responses = await Promise.all(Array.from({ length: 20 }, () => placeOrder(productId, 1)));

      expect(responses.filter((r) => r.status === 201)).toHaveLength(2);
      const [product] = await getProducts();
      expect(product.available).toBe(0);
    }
  });

  it("a request that is only partly satisfiable holds nothing", async () => {
    const productId = await addProduct(2);
    const res = await placeOrder(productId, 3);
    expect(res.status).toBe(409);
    expect((await getProducts())[0].available).toBe(2);
  });

  it("returns the server-measured seconds left on the hold", async () => {
    const productId = await addProduct(5, 4500);
    const res = await placeOrder(productId, 2);
    const order = await res.json();
    expect(res.status).toBe(201);
    expect(order.totalPaise).toBe(9000);
    expect(order.expiresInSeconds).toBeGreaterThan(115);
    expect(order.expiresInSeconds).toBeLessThanOrEqual(120);
  });

  it("an expired hold gives the units back and the order shows as expired", async () => {
    const productId = await addProduct(1);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    expect((await getProducts())[0].available).toBe(0);

    await expireOrder(order.id);

    expect((await getProducts())[0].available).toBe(1);
    const again = await placeOrder(productId, 1);
    expect(again.status).toBe(201);
  });
});
