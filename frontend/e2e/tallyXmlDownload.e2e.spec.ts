import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import axios from "axios";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4100";
const skipIngest = process.env.E2E_SKIP_INGEST === "true";
const loginEmail = process.env.E2E_LOGIN_EMAIL ?? "tenant-admin-1@local.test";
const loginPassword = process.env.E2E_LOGIN_PASSWORD ?? "DemoPass!1";

interface InvoiceListItem {
  _id: string;
  attachmentName: string;
  status: string;
}

interface InvoiceListResponse {
  total: number;
  items: InvoiceListItem[];
}

test.describe("Tally XML download", () => {
  let authToken = "";

  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);
    authToken = await createE2ESessionToken(apiBaseUrl);
    await completeE2ETenantOnboarding(request, authToken);

    if (!skipIngest) {
      await triggerAndWaitForIngestion(request, authToken);
    }

    await ensureApprovedInvoicesExist(request, authToken);
  });

  test("downloads XML from toolbar, validates Tally envelope structure", async ({ page }) => {
    await seedAuthToken(page, authToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();

    // Wait for invoices to load
    await expect.poll(async () => page.locator("tbody tr").count()).toBeGreaterThan(0);

    // Select approved invoices using the header checkbox (select all)
    const headerCheckbox = page.locator("thead input[type='checkbox']");
    await headerCheckbox.check();

    // Click the Download XML button
    const downloadButton = page.getByRole("button", { name: /Download XML/i });
    await expect(downloadButton).toBeEnabled({ timeout: 5_000 });

    const downloadPromise = page.waitForEvent("download");
    await downloadButton.click();

    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    // Read the downloaded file and validate contents
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(downloadPath!, "utf-8");

    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("<ENVELOPE>");
    expect(content).toContain("<TALLYREQUEST>Import</TALLYREQUEST>");
    expect(content).toContain("<TYPE>Data</TYPE>");
    expect(content).toContain("<VOUCHER");
    expect(content).toContain("</ENVELOPE>");

    // Verify the filename suggests XML
    expect(download.suggestedFilename()).toMatch(/\.xml$/i);
  });

  test("downloads XML from Export History dashboard", async ({ page, request }) => {
    // First generate a batch via API so history has at least one entry
    const generateResponse = await request.post(`${apiBaseUrl}/api/exports/tally/download`, {
      headers: authHeaders(authToken),
      data: { requestedBy: "e2e-test" }
    });

    // If no approved invoices, skip (they were already exported above)
    if (generateResponse.status() === 404) {
      // Re-approve invoices so we can generate again
      await ensureApprovedInvoicesExist(request, authToken);
      const retryResponse = await request.post(`${apiBaseUrl}/api/exports/tally/download`, {
        headers: authHeaders(authToken),
        data: { requestedBy: "e2e-test" }
      });
      expect(retryResponse.ok()).toBeTruthy();
    }

    await seedAuthToken(page, authToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();

    // Navigate to Exports tab
    const exportsTab = page.getByRole("button", { name: /Exports/i });
    await expect(exportsTab).toBeVisible();
    await exportsTab.click();

    // Wait for export history table to load
    await expect
      .poll(async () => page.locator(".export-history-table tbody tr").count(), { timeout: 10_000 })
      .toBeGreaterThanOrEqual(1);

    // Click the Download XML button in the history row
    const historyDownloadButton = page
      .locator(".export-history-table tbody tr")
      .first()
      .getByRole("button", { name: /Download XML/i });
    await expect(historyDownloadButton).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await historyDownloadButton.click();

    const download = await downloadPromise;
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();

    const fs = await import("node:fs/promises");
    const content = await fs.readFile(downloadPath!, "utf-8");

    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain("<ENVELOPE>");
    expect(content).toContain("<TALLYREQUEST>Import</TALLYREQUEST>");
    expect(content).toContain("<VOUCHER");
    expect(content).toContain("</ENVELOPE>");
  });

  test("export history shows batch metadata after generation", async ({ page, request }) => {
    await seedAuthToken(page, authToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();

    // Navigate to Exports tab
    const exportsTab = page.getByRole("button", { name: /Exports/i });
    await exportsTab.click();

    // Wait for history to load
    await expect
      .poll(async () => page.locator(".export-history-table tbody tr").count(), {
        message: "expected at least one export history entry"
      })
      .toBeGreaterThan(0);

    // Validate table columns are present
    const firstRow = page.locator(".export-history-table tbody tr").first();
    const cells = firstRow.locator("td");
    await expect(cells).toHaveCount(6); // Date, Total, Success, Failed, Requested By, Download

    // Total should be a positive number
    const totalCell = cells.nth(1);
    const totalText = await totalCell.textContent();
    expect(Number(totalText)).toBeGreaterThan(0);
  });
});

// --- Helpers ---

async function expectBackendReady(request: APIRequestContext): Promise<void> {
  const health = await request.get(`${apiBaseUrl}/health`);
  expect(health.ok()).toBeTruthy();
  const payload = (await health.json()) as { ready?: boolean };
  expect(payload.ready).toBe(true);
}

async function createE2ESessionToken(apiRoot: string): Promise<string> {
  const response = await axios.post<{ token?: string }>(
    `${apiRoot}/auth/token`,
    { email: loginEmail, password: loginPassword },
    { timeout: 30_000, validateStatus: () => true }
  );
  if (response.status !== 200) {
    throw new Error(`Failed to login with credentials (HTTP ${response.status}).`);
  }
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) {
    throw new Error("Credential login did not return a session token.");
  }
  return token;
}

async function completeE2ETenantOnboarding(request: APIRequestContext, token: string): Promise<void> {
  const session = await request.get(`${apiBaseUrl}/api/session`, {
    headers: authHeaders(token)
  });
  expect(session.ok()).toBeTruthy();
  const payload = (await session.json()) as {
    tenant?: { onboarding_status?: string; name?: string };
    user?: { email?: string };
  };

  if (payload.tenant?.onboarding_status === "completed") {
    return;
  }

  const complete = await request.post(`${apiBaseUrl}/api/tenant/onboarding/complete`, {
    headers: authHeaders(token),
    data: {
      tenantName: payload.tenant?.name ?? "local-tenant",
      adminEmail: payload.user?.email ?? "admin@local.test"
    }
  });
  expect(complete.ok()).toBeTruthy();
}

async function triggerAndWaitForIngestion(request: APIRequestContext, token: string): Promise<void> {
  const trigger = await request.post(`${apiBaseUrl}/api/jobs/ingest`, {
    headers: authHeaders(token)
  });
  expect(trigger.status()).toBe(202);

  const startedAt = Date.now();
  const timeoutMs = 20 * 60_000;
  while (Date.now() - startedAt < timeoutMs) {
    const statusResponse = await request.get(`${apiBaseUrl}/api/jobs/ingest/status`, {
      headers: authHeaders(token)
    });
    expect(statusResponse.ok()).toBeTruthy();
    const status = (await statusResponse.json()) as { state: string; error?: string };

    if (status.state === "failed") {
      throw new Error(`Ingestion failed: ${status.error ?? "unknown error"}`);
    }
    if (status.state === "completed") {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Timed out waiting for ingestion after ${timeoutMs}ms`);
}

async function ensureApprovedInvoicesExist(request: APIRequestContext, token: string): Promise<void> {
  const list = await request.get(`${apiBaseUrl}/api/invoices?page=1&limit=100`, {
    headers: authHeaders(token)
  });
  expect(list.ok()).toBeTruthy();
  const data = (await list.json()) as InvoiceListResponse;

  const pendingIds = data.items
    .filter((item) => item.status === "PENDING_REVIEW" || item.status === "VERIFIED")
    .map((item) => item._id);

  if (pendingIds.length === 0) {
    // If there are already approved invoices, nothing to do
    const approvedCount = data.items.filter((item) => item.status === "APPROVED").length;
    if (approvedCount > 0) {
      return;
    }
    throw new Error("No invoices available to approve for export E2E test.");
  }

  const approve = await request.post(`${apiBaseUrl}/api/invoices/approve`, {
    headers: authHeaders(token),
    data: { ids: pendingIds }
  });
  expect(approve.ok()).toBeTruthy();
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function seedAuthToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("billforge_session_token", value);
  }, token);
}
