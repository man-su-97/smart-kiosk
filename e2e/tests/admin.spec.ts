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
  await expect(page.getByRole("tab")).toHaveText(["Dashboard", "Products", "Staff & duty", "Cash queue", "Reports"]);
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

test("smart upload: a wide photo becomes a 512 x 512 square on the product and the kiosk", async ({ page, context }) => {
  const name = `Photo snack ${Date.now()}`;
  await loginToPortal(page, "admin");
  await page.getByRole("tab", { name: "Products" }).click();
  await page.getByRole("button", { name: "+ Add product" }).click();
  const form = page.getByRole("form", { name: "New product" });
  await form.getByLabel("Name").fill(name);
  await form.getByLabel("Category").fill("chips");
  await form.getByLabel("Price (₹)").fill("40");
  await form.getByLabel("Stock (units)").fill("5");

  await form.getByLabel("Image file").setInputFiles(new URL("../fixtures/snack-photo.jpg", import.meta.url).pathname);
  await expect(form.getByTestId("image-info")).toHaveText("✓ 1200×800 → standard 512×512 (smart-cropped to a square)");

  // A link to a web page (not a picture) is explained, not silently ignored.
  await form.getByLabel("Image link").fill("http://example.com/page");
  await form.getByRole("button", { name: "Import" }).click();
  await expect(form.getByText("Only https:// links can be imported")).toBeVisible();

  await form.getByRole("button", { name: "Save" }).click();
  const row = page.getByTestId("product-row").filter({ hasText: name });
  await expect(row.locator("img")).toHaveAttribute("src", /^\/api\/images\/[0-9a-f-]{36}$/);

  const kiosk = await context.newPage();
  await kiosk.goto("/");
  const img = kiosk.getByTestId("product").filter({ hasText: name }).locator("img");
  await expect(img).toBeVisible();
  expect(await img.evaluate((el: HTMLImageElement) => [el.naturalWidth, el.naturalHeight])).toEqual([512, 512]);

  await row.getByRole("button", { name: "Hide" }).click(); // tidy up for the other tests
});

test("admin adds staff and a kiosk, schedules duty; overlaps are refused; staff see their duty", async ({ page, browser }) => {
  const stamp = Date.now();
  const kioskCode = `E2E-${stamp % 100000}`;
  const email = `e2e-${stamp}@kiosk.local`;
  const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86_400_000));

  await loginToPortal(page, "admin");
  await page.getByRole("tab", { name: "Staff & duty" }).click();

  const people = page.getByRole("form", { name: "New staff member" });
  await people.getByLabel("Full name").fill("Kavya Test");
  await people.getByLabel("Staff email").fill(email);
  await people.getByLabel("Staff password").fill("kavya-pass-1");
  await people.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("person-row").filter({ hasText: email })).toContainText("Kavya Test");

  const kiosks = page.getByRole("form", { name: "New kiosk" });
  await kiosks.getByLabel("Kiosk code").fill(kioskCode);
  await kiosks.getByLabel("Kiosk name").fill("Test Counter");
  await kiosks.getByRole("button", { name: "Add" }).click();
  await expect(page.getByTestId("kiosk-row").filter({ hasText: kioskCode })).toContainText("Nobody on duty");

  const shift = page.getByRole("form", { name: "New shift" });
  const book = async (start: string, end: string) => {
    await shift.getByLabel("Kiosk").selectOption({ label: `${kioskCode} · Test Counter` });
    await shift.getByLabel("Staff member").selectOption({ label: "Kavya Test" });
    await shift.getByLabel("Date").fill(tomorrow);
    await shift.getByLabel("Start").fill(start);
    await shift.getByLabel("End").fill(end);
    await shift.getByRole("button", { name: "Add shift" }).click();
  };
  await page.getByTestId("roster").getByLabel("Week from").fill(tomorrow);
  await book("09:00", "17:00");
  await expect(page.getByTestId("shift-row").filter({ hasText: kioskCode })).toContainText("09:00–17:00");

  await book("16:00", "20:00"); // overlaps: this kiosk already has someone from 09:00 to 17:00
  await expect(page.getByText("Someone is already on duty at this kiosk during those hours")).toBeVisible();

  // Kavya logs in (separate browser) and sees her duty.
  const staffContext = await browser.newContext();
  const staffPage = await staffContext.newPage();
  await staffPage.goto("/admin");
  await staffPage.getByLabel("Email").fill(email);
  await staffPage.getByLabel("Password").fill("kavya-pass-1");
  await staffPage.getByRole("button", { name: "Log in" }).click();
  await expect(staffPage.getByTestId("my-duty")).toContainText(`${kioskCode} · Test Counter`);
  await expect(staffPage.getByTestId("my-duty")).toContainText("09:00–17:00");
  await staffContext.close();
});
