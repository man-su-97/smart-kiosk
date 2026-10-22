import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addProduct, claim, createPaidOrder, expireOrder, getProducts, getStock, placeOrder, resetDb,
  startApp, stopApp,
} from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

describe("pickup claim", () => {
  it("two lockers claim at the same moment: exactly one succeeds", async () => {
    const productId = await addProduct(5, 1000);
    const orderId = await createPaidOrder(productId, 2, 2000);

    const responses = await Promise.all([claim(orderId), claim(orderId)]);
    const statuses = responses.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 409]);
    // Stock dropped once (5 -> 3), not twice.
    expect(await getStock(productId)).toBe(3);
  });

  it("ten lockers at once: still exactly one winner", async () => {
    const productId = await addProduct(5, 1000);
    const orderId = await createPaidOrder(productId, 1, 1000);

    const responses = await Promise.all(Array.from({ length: 10 }, () => claim(orderId)));

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await getStock(productId)).toBe(4);
  });

  it("an unpaid order cannot be claimed", async () => {
    const productId = await addProduct(5, 1000);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    expect((await claim(order.id)).status).toBe(409);
    expect(await getStock(productId)).toBe(5);
  });

  it("an expired order cannot be claimed", async () => {
    const productId = await addProduct(5, 1000);
    const order = await placeOrder(productId, 1).then((r) => r.json());
    await expireOrder(order.id);
    expect((await claim(order.id)).status).toBe(409);
  });

  it("an unknown order gives 404", async () => {
    const res = await claim("00000000-0000-4000-8000-000000000000");
    expect(res.status).toBe(404);
  });

  it("a claimed order keeps available units consistent", async () => {
    const productId = await addProduct(5, 1000);
    const orderId = await createPaidOrder(productId, 2, 2000);
    expect((await getProducts())[0].available).toBe(3); // paid but not picked up: still held
    await claim(orderId);
    const [product] = await getProducts();
    expect(product.stock).toBe(3);
    expect(product.available).toBe(3);
  });
});
