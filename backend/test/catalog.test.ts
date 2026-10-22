import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { api, getProducts, loginAs, placeOrder, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);

let admin: Record<string, string>;
beforeEach(async () => {
  await resetDb();
  admin = (await loginAs("admin")).headers;
});

const valid = {
  name: "Nachos",
  pricePaise: 5000,
  costPaise: 2500,
  stock: 10,
  category: "Chips",
  imageUrl: "https://example.com/nachos.png",
};
const create = (body: unknown, headers = admin) => api("/admin/products", { method: "POST", body, headers });
const update = (id: number, body: unknown, headers = admin) =>
  api(`/admin/products/${id}`, { method: "PATCH", body, headers });

describe("product catalog", () => {
  it("creates a product that the kiosk then shows (without the cost price)", async () => {
    const res = await create(valid);
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created).toMatchObject({ name: "Nachos", category: "chips", costPaise: 2500, available: 10, active: true });

    const [kiosk] = await getProducts();
    expect(kiosk).toMatchObject({ id: created.id, name: "Nachos", category: "chips", imageUrl: valid.imageUrl });
    expect(kiosk).not.toHaveProperty("costPaise");
  });

  it("rejects bad input with 400", async () => {
    const bad = [
      { ...valid, pricePaise: 0 },
      { ...valid, pricePaise: 49.5 }, // paise must be whole numbers
      { ...valid, stock: -1 },
      { ...valid, imageUrl: "http://example.com/x.png" }, // https only
      { ...valid, imageUrl: "not a url" },
      { ...valid, category: "<script>" },
      { ...valid, costPaise: 6000 }, // cost above price
      { ...valid, discount: 10 }, // unknown field
      { name: "Only a name" },
    ];
    for (const body of bad) expect((await create(body)).status, JSON.stringify(body)).toBe(400);
    expect(await getProducts()).toHaveLength(0);
  });

  it("only admins can manage products", async () => {
    const staff = (await loginAs("staff")).headers;
    expect((await create(valid, staff)).status).toBe(403);
    expect((await create(valid, {})).status).toBe(401);
  });

  it("updates part of a product", async () => {
    const { id } = await create(valid).then((r) => r.json());
    const res = await update(id, { pricePaise: 5500, imageUrl: null });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ pricePaise: 5500, imageUrl: null, name: "Nachos" });
    expect((await update(id, { costPaise: 9000 })).status).toBe(400); // above the price
  });

  it("hiding a product removes it from the kiosk and it cannot be ordered", async () => {
    const { id } = await create(valid).then((r) => r.json());
    expect((await update(id, { active: false })).status).toBe(200);
    expect(await getProducts()).toHaveLength(0);
    expect((await placeOrder(id, 1)).status).toBe(400);
    // Still listed for the admin, so it can be shown again.
    const all = await api("/admin/products", { headers: admin }).then((r) => r.json());
    expect(all[0]).toMatchObject({ id, active: false });
  });

  it("stock cannot be set below the units already held by orders", async () => {
    const { id } = await create({ ...valid, stock: 5 }).then((r) => r.json());
    expect((await placeOrder(id, 3)).status).toBe(201); // 3 held

    const tooLow = await update(id, { stock: 2 });
    expect(tooLow.status).toBe(409);
    expect((await tooLow.json()).error).toBe("STOCK_BELOW_HELD");
    expect((await update(id, { stock: 3 })).status).toBe(200); // exactly the held units is fine
    expect((await getProducts())[0].available).toBe(0);
  });

  it("an order and a stock cut at the same moment never oversell", async () => {
    for (let round = 0; round < 10; round++) {
      await resetDb();
      admin = (await loginAs("admin")).headers;
      const { id } = await create({ ...valid, stock: 2 }).then((r) => r.json());

      const [order, cut] = await Promise.all([placeOrder(id, 2), update(id, { stock: 0 })]);

      // Exactly one wins: the order (then the cut is refused) or the cut (then the order fails).
      expect([order.status, cut.status].sort()).toEqual(order.status === 201 ? [201, 409] : [200, 409]);
      expect((await getProducts())[0]?.available ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it("orders keep the cost from when they were placed", async () => {
    const { id } = await create(valid).then((r) => r.json());
    await placeOrder(id, 1);
    await update(id, { costPaise: 4000 });
    const { rows } = await pool.query("SELECT unit_cost_paise FROM order_items");
    expect(rows[0].unit_cost_paise).toBe(2500);
  });
});
