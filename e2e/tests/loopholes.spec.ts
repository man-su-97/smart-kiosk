import { expect, test, type APIRequestContext } from "@playwright/test";
import { createHmac } from "node:crypto";
import pg from "pg";
import { ACCOUNTS, getProducts, loginToPortal } from "./helpers";

// Attack tests: each one tries a way to lose money or stock, the way a dishonest customer,
// staff member or outsider would, and asserts the SAFE outcome.
// They go through the same address the browser uses (http://localhost:5173/api/...).

const LOCKER_KEY = process.env.LOCKER_KEY ?? "dev-locker-key"; // docker-compose.yml
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? "dev-webhook-secret";
// Set when running against a production build that has NOT opted into the payment simulator.
const SIMULATOR_SHOULD_BE_OFF = process.env.E2E_EXPECT_SIMULATOR_OFF === "1";

const db = async <T>(work: (c: pg.Client) => Promise<T>) => {
  const client = new pg.Client({ connectionString: "postgres://postgres:postgres@localhost:5432/pickup" });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

async function productId(name: string) {
  return (await getProducts()).find((p) => p.name === name).id as number;
}
async function order(request: APIRequestContext, name: string, quantity = 1, extra: Record<string, unknown> = {}) {
  const res = await request.post("/api/orders", { data: { items: [{ productId: await productId(name), quantity }], ...extra } });
  return { res, body: await res.json() };
}
async function signedWebhook(request: APIRequestContext, orderId: string, amountPaise: number, eventId: string) {
  const body = JSON.stringify({ eventId, orderId, amountPaise, status: "captured" });
  return request.post("/api/payments/webhook", {
    headers: { "Content-Type": "application/json", "X-Signature": createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex") },
    data: body,
  });
}
const expire = (orderId: string) =>
  db((c) => c.query("UPDATE orders SET expires_at = now() - interval '1 second' WHERE id = $1", [orderId]));

test.describe("free goods", () => {
  test("L1 mock UPI cannot be used to pay for free in production", async ({ request }) => {
    test.skip(!SIMULATOR_SHOULD_BE_OFF, "only meaningful against a production build without ALLOW_SIMULATOR_IN_PRODUCTION");
    const { body } = await order(request, "Masala Chips");
    const res = await request.post("/api/payments/mock-success", { data: { orderId: body.id } });
    expect(res.status()).toBe(404);
    expect((await request.get(`/api/orders/${body.id}`).then((r) => r.json())).status).toBe("pending");
  });

  test("L2 a stranger who knows an order id cannot open its locker", async ({ request }) => {
    const { body } = await order(request, "Masala Chips");
    await signedWebhook(request, body.id, body.totalPaise, `evt_l2_${body.id}`);

    expect((await request.post(`/api/orders/${body.id}/pickup-claim`)).status()).toBe(401);
    expect((await request.post(`/api/orders/${body.id}/pickup-claim`, { headers: { "X-Locker-Key": "guess" } })).status()).toBe(401);
    expect((await request.get(`/api/orders/${body.id}`).then((r) => r.json())).status).toBe("paid"); // still collectable
    // The real locker (with its key) can.
    expect((await request.post(`/api/orders/${body.id}/pickup-claim`, { headers: { "X-Locker-Key": LOCKER_KEY } })).status()).toBe(200);
  });

  test("L8 the customer cannot set the price", async ({ request }) => {
    const res = await request.post("/api/orders", {
      data: { items: [{ productId: await productId("Cold Coffee"), quantity: 1, pricePaise: 1 }], totalPaise: 1 },
    });
    expect(res.status()).toBe(201);
    expect((await res.json()).totalPaise).toBe(6000);
  });

  test("L11 replayed, forged and underpaid webhooks do not pay", async ({ request }) => {
    const { body } = await order(request, "Glucose Biscuits");
    const forged = await request.post("/api/payments/webhook", {
      headers: { "Content-Type": "application/json", "X-Signature": "0".repeat(64) },
      data: JSON.stringify({ eventId: "evt_forged", orderId: body.id, amountPaise: body.totalPaise, status: "captured" }),
    });
    expect(forged.status()).toBe(401);
    await signedWebhook(request, body.id, 1, `evt_l11_${body.id}`); // pays 1 paisa
    expect((await request.get(`/api/orders/${body.id}`).then((r) => r.json())).status).toBe("needs_review");
  });
});

test.describe("stock abuse", () => {
  test("L3 a script cannot hold all the stock so real customers see Sold out", async ({ request }) => {
    const created: string[] = [];
    let blocked = false;
    for (let i = 0; i < 15; i++) {
      const { res, body } = await order(request, "Glucose Biscuits"); // 15 in stock
      if (res.status() === 429) {
        blocked = true;
        expect(body.message).toMatch(/too many/i);
        break;
      }
      created.push(body.id);
    }
    for (const id of created) await expire(id); // release, so the other tests start clean
    expect(blocked).toBe(true);
    expect(created.length).toBeLessThan(15);
  });

  test("L4 the 50-per-product limit cannot be dodged by repeating a line", async ({ request }) => {
    const id = await productId("Glucose Biscuits");
    const res = await request.post("/api/orders", { data: { items: [{ productId: id, quantity: 40 }, { productId: id, quantity: 40 }] } });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/50/);
  });

  test("L9 hidden products and silly quantities are refused", async ({ request }) => {
    const id = await productId("Roasted Peanuts");
    for (const quantity of [0, -1, 1.5, 51]) {
      expect((await request.post("/api/orders", { data: { items: [{ productId: id, quantity }] } })).status(), String(quantity)).toBe(400);
    }
    await db((c) => c.query("UPDATE products SET active = false WHERE id = $1", [id]));
    try {
      expect((await request.post("/api/orders", { data: { items: [{ productId: id, quantity: 1 }] } })).status()).toBe(400);
    } finally {
      await db((c) => c.query("UPDATE products SET active = true WHERE id = $1", [id]));
    }
  });
});

test.describe("money and cash handling", () => {
  test("L5 a second payment for a paid order is flagged for a refund, not silently kept", async ({ page, request }) => {
    const { body } = await order(request, "Chocolate Bar");
    await signedWebhook(request, body.id, body.totalPaise, `evt_l5a_${body.id}`);
    const second = await signedWebhook(request, body.id, body.totalPaise, `evt_l5b_${body.id}`); // customer paid again
    expect((await second.json()).result).toBe("duplicate_payment");

    await loginToPortal(page, "admin");
    const attention = page.getByTestId("needs-attention");
    await expect(attention).toContainText("Paid twice");
    await expect(attention).toContainText("₹45.00");
  });

  test("L5b staff are told not to take cash for an order already paid by UPI", async ({ page, request }) => {
    const { body } = await order(request, "Chocolate Bar");
    await request.post(`/api/orders/${body.id}/cash-request`, { data: {} });
    await signedWebhook(request, body.id, body.totalPaise, `evt_l5c_${body.id}`); // customer also paid by UPI

    await loginToPortal(page, "staff");
    const res = await page.request.post(`/api/admin/orders/${body.id}/approve-cash`);
    expect(res.status()).toBe(409);
    expect((await res.json()).message).toMatch(/already paid/i);
  });

  test("L6 cash handed over just before the hold ran out can still be recorded", async ({ browser, request }) => {
    const kiosk = await (await browser.newContext()).newPage();
    await kiosk.goto("/");
    await kiosk.getByRole("button", { name: "Add Cold Coffee" }).click();
    await kiosk.getByRole("button", { name: "View cart" }).click();
    await kiosk.getByRole("button", { name: "Place order" }).click();
    await kiosk.getByRole("tab", { name: /Cash/ }).click();
    await kiosk.getByRole("button", { name: "Pay with Cash" }).click();
    const orderId = (await kiosk.locator(".order-id").innerText()).trim();

    await expire(orderId); // staff were slow: the 120 s ran out while counting the money
    await expect(kiosk.getByRole("heading", { name: "Time ran out" })).toBeVisible({ timeout: 8000 });
    await expect(kiosk.getByText(/already paid cash/i)).toBeVisible();

    const staff = await (await browser.newContext()).newPage();
    await loginToPortal(staff, "staff");
    const late = staff.getByTestId("cash-request").filter({ hasText: orderId.slice(0, 8) });
    await expect(late).toContainText("Late");
    await late.getByRole("button", { name: "Approve Cash Received" }).click();

    // The kiosk was still listening and unlocks the locker.
    await expect(kiosk.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
    expect(request).toBeTruthy();
  });
});

test.describe("access and forgery", () => {
  test("L12 staff cannot reach admin data", async ({ page }) => {
    await loginToPortal(page, "staff");
    for (const path of ["/api/admin/products", "/api/admin/analytics/summary?from=2026-10-01&to=2026-10-02", "/api/admin/users", "/api/admin/shifts?from=2026-10-01&to=2026-10-02"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
  });

  test("L13 two lockers at once: one opens", async ({ request }) => {
    const { body } = await order(request, "Masala Chips");
    await signedWebhook(request, body.id, body.totalPaise, `evt_l13_${body.id}`);
    const headers = { "X-Locker-Key": LOCKER_KEY };
    const results = await Promise.all([
      request.post(`/api/orders/${body.id}/pickup-claim`, { headers }),
      request.post(`/api/orders/${body.id}/pickup-claim`, { headers }),
    ]);
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
  });

  test("L14 another website cannot switch a customer's order to cash (form post)", async ({ request }) => {
    const { body } = await order(request, "Masala Chips");
    // What a hidden <form method=post> on another site would send: no JSON content type.
    const res = await request.post(`/api/orders/${body.id}/cash-request`, { form: { x: "1" } });
    expect(res.status()).toBe(415);
    expect((await request.get(`/api/orders/${body.id}`).then((r) => r.json())).status).toBe("pending");
  });

  test("L7 image import cannot be pointed at the server's own network", async ({ page }) => {
    await loginToPortal(page, "admin");
    for (const url of ["https://localhost/x.png", "https://127.0.0.1/x.png", "https://169.254.169.254/latest", "http://example.com/x.png"]) {
      expect((await page.request.post("/api/admin/images/import", { data: { url } })).status(), url).toBe(400);
    }
  });
});

test("accounts used here exist", () => {
  expect(ACCOUNTS.staff.email).toContain("@");
});
