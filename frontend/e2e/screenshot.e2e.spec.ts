import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1400, height: 3000 } });

test("Screenshot detail panel with bounding boxes", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 15000 });
  await page.getByLabel("Email Address").fill("firm-partner@local.test");
  await page.locator('input[type="password"]').fill("DemoPass!1");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page.getByRole("heading", { name: "LedgerBuddy" })).toBeVisible({ timeout: 20000 });

  await page.getByRole("button", { name: "Invoices" }).click();
  await page.waitForTimeout(2000);
  await page.locator("table tbody tr").first().waitFor({ state: "visible", timeout: 10000 });
  await page.locator("table tbody tr").first().click();
  await page.waitForTimeout(3000);

  await page.screenshot({ path: "/tmp/ledgerbuddy-full-tall.png", fullPage: true });
});
