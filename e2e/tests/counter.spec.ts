import { expect, test, type Page } from "@playwright/test";
import { claimPickup, expireOrder, getProducts, sendWebhook } from "./helpers";

import { loginToPortal } from "./helpers";

const card = (page: Page, name: string) => page.getByTestId("product").filter({ hasText: name });

// Chocolate Bar: ₹45.00 (4500 paise). Add 1 to the cart, open the cart, place the order.
async function orderOneChocolateBar(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Chocolate Bar" }).click();
  await page.getByRole("button", { name: "View cart" }).click();
  await expect(page.getByText("Total: ₹45.00")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Pay ₹45.00" })).toBeVisible();
  return (await page.locator(".order-id").innerText()).trim();
}

const countdownSeconds = async (page: Page) => {
  const [m, s] = (await page.locator(".countdown").innerText()).split(":").map(Number);
  return m * 60 + s;
};

test("shows 5 products, each with an illustration and a stock badge", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("product")).toHaveCount(5);
  await expect(page.locator("svg.product-icon")).toHaveCount(5);
  await expect(page.locator(".badge")).toHaveCount(5);
  await expect(card(page, "Masala Chips").locator(".badge")).toContainText(/in stock|left|Sold out/);
  // Each product type gets its own drawing (the chocolate wrapper says CHOCO, the drink has a straw).
  await expect(card(page, "Chocolate Bar").locator("svg.product-icon")).toContainText("CHOCO");
  await expect(card(page, "Cold Coffee").locator("svg.product-icon")).not.toContainText("CHOCO");
  // No two products share the same drawing.
  const drawings = await page.locator("svg.product-icon").evaluateAll((svgs) => svgs.map((s) => s.innerHTML));
  expect(new Set(drawings).size).toBe(drawings.length);
});

test("stock badge colours: green when plenty, orange when low, red when sold out", async ({ page }) => {
  const products = await getProducts();
  await page.goto("/");
  for (const p of products) {
    const expected = p.available === 0 ? "red" : p.available <= 3 ? "orange" : "green";
    await expect(card(page, p.name).locator(".badge")).toHaveClass(new RegExp(expected));
  }
});

test("adding shows a toast and a cart pill; the cart drawer lists and edits items", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "View cart" })).toHaveCount(0); // empty cart: no pill

  await page.getByRole("button", { name: "Add Cold Coffee" }).click();
  await expect(page.getByRole("status")).toHaveText(/Cold Coffee added to cart/);
  await expect(page.getByRole("button", { name: "View cart" })).toContainText("1 item · ₹60.00");

  await page.getByRole("button", { name: "Add Glucose Biscuits" }).click();
  await page.getByRole("button", { name: "Add Glucose Biscuits" }).click();
  await expect(page.getByRole("button", { name: "View cart" })).toContainText("3 items · ₹80.00");

  await page.getByRole("button", { name: "View cart" }).click();
  const drawer = page.getByRole("dialog", { name: "Your cart" });
  await expect(drawer).toContainText("Cold Coffee");
  await expect(drawer).toContainText("Glucose Biscuits");
  await expect(drawer.getByText("Total: ₹80.00")).toBeVisible();

  await drawer.getByRole("button", { name: "Increase Cold Coffee" }).click();
  await expect(drawer.getByText("Total: ₹140.00")).toBeVisible();

  // Removing everything empties the cart and closes the drawer.
  await drawer.getByRole("button", { name: "Decrease Cold Coffee" }).click();
  await drawer.getByRole("button", { name: "Decrease Cold Coffee" }).click();
  await drawer.getByRole("button", { name: "Decrease Glucose Biscuits" }).click();
  await drawer.getByRole("button", { name: "Decrease Glucose Biscuits" }).click();
  await expect(drawer).toHaveCount(0);
});

test("order -> UPI QR + countdown -> payment -> locker animation -> pickup", async ({ page }) => {
  const orderId = await orderOneChocolateBar(page);

  await expect(page.locator(".qr-box svg")).toBeVisible();
  await expect(page.getByText("Scan with your phone camera")).toBeVisible();
  await expect(page.locator(".command")).toHaveText(`npm run send-webhook -- ${orderId} 4500`);
  await expect(page.locator(".summary")).toContainText("1 × Chocolate Bar");

  const left = await countdownSeconds(page);
  expect(left).toBeGreaterThan(110);
  expect(left).toBeLessThanOrEqual(120);

  await sendWebhook(orderId, 4500);
  await expect(page.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Locker Unlocked")).toBeVisible();
  // The locker animation plays: the order (bag) slides out and becomes fully visible.
  await expect(page.locator(".locker-scene")).toBeVisible();
  await expect(page.locator(".locker-bag")).toHaveCSS("opacity", "1", { timeout: 5000 });

  const claim = await claimPickup(orderId);
  expect(claim.status).toBe(200);
  expect((await claimPickup(orderId)).status).toBe(409);
});

test("UPI: the QR opens the mock UPI page; approving it on the 'phone' unlocks the kiosk", async ({ page, context }) => {
  const orderId = await orderOneChocolateBar(page);

  // The phone: a second page opening the same link the QR code holds.
  const phone = await context.newPage();
  await phone.goto(`/mock-pay?orderId=${orderId}`);
  await expect(phone.getByText("₹45.00")).toBeVisible(); // amount read from the server
  await phone.getByRole("button", { name: "Approve Mock UPI Payment" }).click();
  await expect(phone.getByText("Payment approved")).toBeVisible();

  await expect(page.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
});

test("UPI: the on-screen 'Simulate UPI Payment Success' button pays the order", async ({ page }) => {
  await orderOneChocolateBar(page);
  await page.getByRole("button", { name: "Simulate UPI Payment Success" }).click();
  await expect(page.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
});

test("cash: customer asks to pay cash, operator approves on /admin, locker unlocks", async ({ page, context }) => {
  const orderId = await orderOneChocolateBar(page);
  await page.getByRole("tab", { name: /Cash/ }).click();
  await page.getByRole("button", { name: "Pay with Cash" }).click();
  await expect(page.getByTestId("cash-waiting")).toContainText("Awaiting operator approval");
  await expect(page.getByRole("tab")).toHaveCount(0); // choice made, tabs hidden

  // The operator, in another tab.
  const admin = await context.newPage();
  await loginToPortal(admin, "staff");
  const request = admin.getByTestId("cash-request").filter({ hasText: orderId.slice(0, 8) });
  await expect(request).toContainText("₹45.00");
  await expect(request).toContainText("1 × Chocolate Bar");
  await request.getByRole("button", { name: "Approve Cash Received" }).click();
  await expect(request).toHaveCount(0); // gone from the list once paid

  await expect(page.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
  await expect(page.locator(".locker-bag")).toHaveCSS("opacity", "1", { timeout: 5000 });
  expect((await claimPickup(orderId)).status).toBe(200);
});

test("cash: operator rejects, the kiosk says declined and the stock comes back", async ({ page, context }) => {
  const before = (await getProducts()).find((p) => p.name === "Chocolate Bar").available;
  const orderId = await orderOneChocolateBar(page);
  await page.getByRole("tab", { name: /Cash/ }).click();
  await page.getByRole("button", { name: "Pay with Cash" }).click();

  const admin = await context.newPage();
  await loginToPortal(admin, "staff");
  await admin.getByTestId("cash-request").filter({ hasText: orderId.slice(0, 8) }).getByRole("button", { name: "Reject" }).click();

  await expect(page.getByRole("heading", { name: "Cash payment declined" })).toBeVisible({ timeout: 8000 });
  expect((await getProducts()).find((p) => p.name === "Chocolate Bar").available).toBe(before);
});

test("countdown is right even when the counter's clock is 10 minutes wrong", async ({ page }) => {
  // Make the browser's wall clock jump 10 minutes ahead before any page code runs.
  await page.addInitScript(() => {
    const RealDate = Date;
    const offset = 10 * 60 * 1000;
    // @ts-ignore
    globalThis.Date = class extends RealDate {
      constructor(...args: any[]) {
        // @ts-ignore
        super(...(args.length ? args : [RealDate.now() + offset]));
      }
      static now() {
        return RealDate.now() + offset;
      }
    };
  });
  await orderOneChocolateBar(page);

  const first = await countdownSeconds(page);
  expect(first).toBeGreaterThan(110);
  expect(first).toBeLessThanOrEqual(120);

  await page.waitForTimeout(3000);
  const later = await countdownSeconds(page);
  expect(first - later).toBeGreaterThanOrEqual(2); // it really counts down
  expect(first - later).toBeLessThanOrEqual(4);
});

test("an expired hold shows the expired message and frees the stock", async ({ page }) => {
  const before = (await getProducts()).find((p) => p.name === "Chocolate Bar").available;
  const orderId = await orderOneChocolateBar(page);
  expect((await getProducts()).find((p) => p.name === "Chocolate Bar").available).toBe(before - 1);

  await expireOrder(orderId);

  await expect(page.getByRole("heading", { name: "Time ran out" })).toBeVisible({ timeout: 8000 });
  expect((await getProducts()).find((p) => p.name === "Chocolate Bar").available).toBe(before);
});

test("a wrong payment amount shows the needs-review message", async ({ page }) => {
  const orderId = await orderOneChocolateBar(page);
  await sendWebhook(orderId, 4400);
  await expect(page.getByText("could not confirm it automatically")).toBeVisible({ timeout: 8000 });
});

test("cannot add more than the available units to the cart", async ({ page }) => {
  await page.goto("/");
  const available = (await getProducts()).find((p) => p.name === "Cold Coffee").available;
  const add = page.getByRole("button", { name: "Add Cold Coffee" });
  for (let i = 0; i < available; i++) await add.click();
  await expect(card(page, "Cold Coffee").locator(".qty-value")).toHaveText(String(available));
  await expect(add).toBeDisabled(); // at the limit, + can no longer be pressed
});
