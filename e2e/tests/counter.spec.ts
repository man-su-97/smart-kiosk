import { expect, test, type Page } from "@playwright/test";
import { claimPickup, expireOrder, getProducts, sendWebhook } from "./helpers";

// Chocolate Bar: ₹45.00 (4500 paise). Order 1 unit of it from the screen.
async function orderOneChocolateBar(page: Page) {
  await page.goto("/");
  const row = page.locator(".row", { hasText: "Chocolate Bar" });
  await row.getByRole("button", { name: "+" }).click();
  await expect(page.getByText("Total: ₹45.00")).toBeVisible();
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByRole("heading", { name: "Pay ₹45.00 by UPI" })).toBeVisible();
  return (await page.locator("code").first().innerText()).trim(); // order id
}

const countdownSeconds = async (page: Page) => {
  const [m, s] = (await page.locator(".countdown").innerText()).split(":").map(Number);
  return m * 60 + s;
};

test("shows the products with available units", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Pickup Counter" })).toBeVisible();
  await expect(page.locator(".row")).toHaveCount(5);
  await expect(page.locator(".row", { hasText: "Masala Chips" })).toContainText("available");
});

test("order -> countdown -> payment -> paid message -> pickup", async ({ page }) => {
  const orderId = await orderOneChocolateBar(page);

  const left = await countdownSeconds(page);
  expect(left).toBeGreaterThan(110);
  expect(left).toBeLessThanOrEqual(120);

  await sendWebhook(orderId, 4500);
  await expect(page.getByText("Payment received!")).toBeVisible({ timeout: 8000 });

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

  await expect(page.getByText("Time ran out")).toBeVisible({ timeout: 8000 });
  expect((await getProducts()).find((p) => p.name === "Chocolate Bar").available).toBe(before);
});

test("a wrong payment amount shows the needs-review message", async ({ page }) => {
  const orderId = await orderOneChocolateBar(page);
  await sendWebhook(orderId, 4400);
  await expect(page.getByText("could not confirm it automatically")).toBeVisible({ timeout: 8000 });
});

test("cannot add more than the available units to the cart", async ({ page }) => {
  await page.goto("/");
  const row = page.locator(".row", { hasText: "Cold Coffee" });
  const available = Number((await row.locator("small").innerText()).match(/\d+/)![0]);
  for (let i = 0; i < available + 3; i++) await row.getByRole("button", { name: "+" }).click();
  await expect(row.locator(".qty span")).toHaveText(String(available));
});
