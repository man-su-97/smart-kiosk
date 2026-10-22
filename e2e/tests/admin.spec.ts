import { expect, test } from "@playwright/test";
import { ACCOUNTS, loginToPortal } from "./helpers";

test("wrong password is refused and the login form stays", async ({ page }) => {
  await page.goto("/admin");
  await page.getByLabel("Email").fill(ACCOUNTS.staff.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByText("Wrong email or password")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Staff login" })).toBeVisible();
});

test("staff only see the cash queue", async ({ page }) => {
  await loginToPortal(page, "staff");
  await expect(page.getByRole("tab")).toHaveText(["Cash queue"]);
  await expect(page.getByRole("heading", { name: "Cash queue" })).toBeVisible();
});

test("the session survives a reload and logout ends it", async ({ page }) => {
  await loginToPortal(page, "admin");
  await page.reload();
  await expect(page.getByTestId("who")).toContainText("admin@kiosk.local");
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Staff login" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Staff login" })).toBeVisible();
});

test("admin dashboard shows KPIs and both charts", async ({ page }) => {
  await loginToPortal(page, "admin");
  await expect(page.getByRole("tab")).toHaveText(["Dashboard", "Products", "Cash queue", "Reports"]);
  await expect(page.getByTestId("kpi")).toHaveCount(4);
  await expect(page.getByTestId("chart-daily").locator("svg.recharts-surface")).toBeVisible();
  await expect(page.getByTestId("chart-categories").locator("svg.recharts-surface")).toBeVisible();
});

test("admin adds a product, the kiosk shows it, then the admin hides it again", async ({ page, context }) => {
  const name = `Nachos ${Date.now()}`;
  await loginToPortal(page, "admin");
  await page.getByRole("tab", { name: "Products" }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();

  const form = page.getByRole("form", { name: "New product" });
  // Client-side validation first: price is required.
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Category").fill("Chips");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(form.getByText("Price must be above ₹0")).toBeVisible();

  await form.getByLabel("Price (₹)").fill("55.50");
  await form.getByLabel("Cost (₹)").fill("30");
  await form.getByLabel("Stock (units)").fill("7");
  await form.getByRole("button", { name: "Save" }).click();
  const row = page.getByTestId("product-row").filter({ hasText: name });
  await expect(row).toContainText("₹55.50");
  await expect(row).toContainText("On sale");

  // The kiosk, in another tab, shows it under its category.
  const kiosk = await context.newPage();
  await kiosk.goto("/");
  await kiosk.getByRole("button", { name: "chips", exact: true }).click();
  const card = kiosk.getByTestId("product").filter({ hasText: name });
  await expect(card).toContainText("₹55.50");
  await expect(card).toContainText("7 in stock");

  // Hide it: gone from the kiosk.
  await row.getByRole("button", { name: "Hide" }).click();
  await expect(row).toContainText("Hidden");
  await kiosk.reload();
  await expect(kiosk.getByTestId("product").filter({ hasText: name })).toHaveCount(0);
});

test("admin downloads the daily PDF report", async ({ page }) => {
  await loginToPortal(page, "admin");
  await page.getByRole("tab", { name: "Reports" }).click();
  await expect(page.getByTestId("report-summary")).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download PDF" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sales-\d{4}-\d{2}-\d{2}\.pdf$/);
  const stream = await download.createReadStream();
  const first = await new Promise<Buffer>((resolve) => stream.once("data", (chunk) => resolve(chunk as Buffer)));
  expect(first.subarray(0, 5).toString()).toBe("%PDF-");
});
