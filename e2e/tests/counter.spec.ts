import { expect, test, type Page } from "@playwright/test";
import { claimPickup, expireOrder, getProducts, sendWebhook } from "./helpers";

const card = (page: Page, name: string) => page.getByTestId("product").filter({ hasText: name });

// Chocolate Bar: ₹45.00 (4500 paise). Order 1 unit of it from the screen.
async function orderOneChocolateBar(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Add Chocolate Bar" }).click();
  await expect(page.getByText("Total: ₹45.00")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Pay ₹45.00 by UPI" })).toBeVisible();
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
});

test("stock badge colours: green when plenty, orange when low, red when sold out", async ({ page }) => {
  const products = await getProducts();
  await page.goto("/");
  for (const p of products) {
    const expected = p.available === 0 ? "red" : p.available <= 3 ? "orange" : "green";
    await expect(card(page, p.name).locator(".badge")).toHaveClass(new RegExp(expected));
  }
});

test("order -> UPI QR + countdown -> payment -> Locker Unlocked -> pickup", async ({ page }) => {
  const orderId = await orderOneChocolateBar(page);

  await expect(page.locator(".qr-box svg")).toBeVisible();
  await expect(page.getByText("Scan with GPay / PhonePe / Paytm")).toBeVisible();
  await expect(page.locator(".command")).toHaveText(`npm run send-webhook -- ${orderId} 4500`);

  const left = await countdownSeconds(page);
  expect(left).toBeGreaterThan(110);
  expect(left).toBeLessThanOrEqual(120);

  await sendWebhook(orderId, 4500);
  await expect(page.getByRole("heading", { name: "Payment Received" })).toBeVisible({ timeout: 8000 });
  await expect(page.getByText("Locker Unlocked")).toBeVisible();

  const claim = await claimPickup(orderId);
  expect(claim.status).toBe(200);
  expect((await claimPickup(orderId)).status).toBe(409);
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
  const coffee = card(page, "Cold Coffee");
  const available = (await getProducts()).find((p) => p.name === "Cold Coffee").available;
  for (let i = 0; i < available + 3; i++) await page.getByRole("button", { name: "Add Cold Coffee" }).click();
  await expect(coffee.locator(".qty-value")).toHaveText(String(available));
});
