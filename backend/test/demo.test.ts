import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/db.js";
import { seedDemoData } from "../src/modules/demo/seedDemo.js";
import { bills } from "../src/modules/reports/service.js";
import { addProduct, getProducts, resetDb, startApp, stopApp } from "./helpers.js";

beforeAll(startApp);
afterAll(stopApp);
beforeEach(resetDb);

const count = (sql: string) => pool.query(sql).then((r) => Number(r.rows[0].n));

describe("sample data", () => {
  it("creates kiosks, a roster and marked sample sales; running again replaces them", async () => {
    await addProduct(10, 2000);
    await addProduct(10, 4500);
    const first = await seedDemoData({ days: 3 });
    expect(first.bills).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM kiosks")).toBe(3);
    expect(await count("SELECT count(*) AS n FROM kiosk_shifts")).toBe(10 * 3 * 2); // 3 past days + 7 ahead
    expect(await count("SELECT count(*) AS n FROM payment_events WHERE event_id NOT LIKE 'demo\\_%'")).toBe(0);

    const second = await seedDemoData({ days: 3 });
    expect(second.bills).toBe(first.bills); // same story every time
    expect(await count("SELECT count(*) AS n FROM orders")).toBe(first.bills); // replaced, not doubled
    expect(await count("SELECT count(*) AS n FROM users")).toBe(4);
  });

  it("sample sales are history: they do not hold or change stock", async () => {
    await addProduct(10, 2000);
    await seedDemoData({ days: 2 });
    const [product] = await getProducts();
    expect(product).toMatchObject({ stock: 10, available: 10 });
  });

  it("every sample bill names a person, and cash bills name the person on duty", async () => {
    await addProduct(10, 2000);
    await seedDemoData({ days: 3 });
    const { rows } = await pool.query("SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date - 2 AS from_day, (now() AT TIME ZONE 'Asia/Kolkata')::date AS to_day");
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const register = await bills({ from: iso(rows[0].from_day), to: iso(rows[0].to_day) });
    expect(register.length).toBeGreaterThan(0);
    expect(register.every((b) => b.demo && b.staff !== "-" && b.kioskCode.startsWith("KSK-BLR-"))).toBe(true);
    expect(new Set(register.map((b) => b.paymentMode))).toEqual(new Set(["UPI", "Cash"]));
  });
});
