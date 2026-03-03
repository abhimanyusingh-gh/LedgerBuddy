import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import axios from "axios";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const skipIngest = process.env.E2E_SKIP_INGEST === "true";
const expectedTotalFiles = Number(process.env.E2E_EXPECT_TOTAL_FILES ?? "3");
const loginEmail = process.env.E2E_LOGIN_EMAIL ?? "tenant-admin-1@local.test";
const loginPassword = process.env.E2E_LOGIN_PASSWORD ?? "DemoPass!1";

interface InvoiceListItem {
  _id: string;
  attachmentName: string;
  status: string;
  mimeType: string;
}

interface InvoiceListResponse {
  total: number;
  items: InvoiceListItem[];
}

interface InvoiceDetailResponse {
  _id: string;
  attachmentName: string;
  mimeType: string;
  status: string;
  parsed?: {
    vendorName?: string;
  };
  ocrBlocks?: Array<{
    text: string;
    page: number;
    bbox: [number, number, number, number];
    bboxNormalized?: [number, number, number, number];
  }>;
}

interface IngestionStatusResponse {
  state: "idle" | "running" | "completed" | "failed";
  totalFiles: number;
  processedFiles: number;
  failures: number;
  error?: string;
}

test.describe("frontend source highlights", () => {
  let authToken = "";

  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);
    authToken = await createE2ESessionToken(apiBaseUrl);
    await completeE2ETenantOnboarding(request, authToken);

    if (!skipIngest) {
      const ingestion = await triggerAndWaitForIngestion(request, authToken);
      expect(ingestion.totalFiles).toBeGreaterThanOrEqual(0);
      if (ingestion.totalFiles > 0) {
        expect(ingestion.processedFiles).toBe(ingestion.totalFiles);
      }
      expect(ingestion.failures).toBe(0);
    }

    const list = await fetchInvoices(request, authToken);
    expect(list.total).toBeGreaterThanOrEqual(expectedTotalFiles);
    expect(list.items.length).toBeGreaterThanOrEqual(expectedTotalFiles);
    expect(list.items.some((item) => /.+\.(jpg|jpeg)$/i.test(item.attachmentName))).toBeTruthy();
    expect(list.items.some((item) => /.+\.png$/i.test(item.attachmentName))).toBeTruthy();
    expect(list.items.some((item) => /.+\.pdf$/i.test(item.attachmentName))).toBeTruthy();
  });

  test("jpg invoice exposes image preview + selectable bbox overlay", async ({ page, request }) => {
    await seedAuthToken(page, authToken);
    const invoice = await resolveInvoiceByExtension(request, /.+\.(jpg|jpeg)$/i, authToken);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });

  test("shows button to trigger email XOAUTH2 simulation workflow", async ({ page }) => {
    await seedAuthToken(page, authToken);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ingest Demo Emails" })).toBeVisible();
  });

  test("png invoice exposes image preview + selectable bbox overlay", async ({ page, request }) => {
    await seedAuthToken(page, authToken);
    const invoice = await resolveInvoiceByExtension(request, /.+\.png$/i, authToken);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });

  test("pdf invoice exposes rendered 300 dpi image preview + selectable bbox overlay", async ({ page, request }) => {
    await seedAuthToken(page, authToken);
    const invoice = await resolveInvoiceByExtension(request, /.+\.pdf$/i, authToken);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });
});

async function verifyInvoiceOverlayFlow(page: Page, attachmentName: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Invoice Workspace" })).toBeVisible();

  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("button", { name: attachmentName }) })
    .first();
  await expect(row).toBeVisible();

  const detailsPanel = page.locator(".detail-panel");
  await expect(detailsPanel.getByRole("heading", { name: "Value Source Highlights" })).toHaveCount(0);

  await row.locator("button.file-label").dispatchEvent("click");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Value Source Highlights" })).toHaveCount(0);
  const revealButton = dialog.getByRole("button", { name: "Show Value Source Highlights" });
  await expect(revealButton).toBeVisible();
  await revealButton.click();

  await expect(dialog.getByRole("heading", { name: "Value Source Highlights" })).toBeVisible();
  await expect(dialog.locator(".source-preview-image img")).toBeVisible();
  await expect
    .poll(
      async () =>
        dialog
          .locator(".source-preview-image img")
          .first()
          .evaluate((element) => window.getComputedStyle(element).objectFit),
      {
        message: `expected source preview to render full invoice without cover-cropping for ${attachmentName}`
      }
    )
    .toBe("contain");
  await expect
    .poll(async () => dialog.locator(".source-highlight-chip").count(), {
      message: `expected source field chips for ${attachmentName}`
    })
    .toBeGreaterThan(0);
  await dialog.locator(".source-highlight-chip").first().click();

  await expect
    .poll(async () => {
      const src = await dialog.locator(".source-preview-image img").first().getAttribute("src");
      return src ?? "";
    })
    .toContain("/source-overlays/");

  await expect
    .poll(async () => dialog.locator("button[aria-label^='Inspect extracted source crop']").count(), {
      message: `expected extracted field crop action buttons for ${attachmentName}`
    })
    .toBeGreaterThan(0);
  await dialog.locator("button[aria-label^='Inspect extracted source crop']").first().click();

  const cropDialog = page.getByRole("dialog", { name: /Cropped source for/i });
  await expect(cropDialog).toBeVisible();
  await expect(cropDialog.locator("img")).toBeVisible();
  await cropDialog.getByRole("button", { name: "Close" }).click();
}

async function expectBackendReady(request: APIRequestContext): Promise<void> {
  const health = await request.get(`${apiBaseUrl}/health`);
  expect(health.ok()).toBeTruthy();
  const payload = (await health.json()) as { ready?: boolean };
  expect(payload.ready).toBe(true);
}

async function triggerAndWaitForIngestion(request: APIRequestContext, token: string): Promise<IngestionStatusResponse> {
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
    const status = (await statusResponse.json()) as IngestionStatusResponse;

    if (status.state === "failed") {
      throw new Error(`Ingestion failed during frontend e2e: ${status.error ?? "unknown error"}`);
    }
    if (status.state === "completed") {
      return status;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }

  throw new Error(`Timed out waiting for ingestion completion after ${timeoutMs}ms`);
}

async function fetchInvoices(request: APIRequestContext, token: string): Promise<InvoiceListResponse> {
  const response = await request.get(`${apiBaseUrl}/api/invoices?page=1&limit=100`, {
    headers: authHeaders(token)
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as InvoiceListResponse;
}

async function resolveInvoiceByExtension(
  request: APIRequestContext,
  pattern: RegExp,
  token: string
): Promise<InvoiceDetailResponse> {
  const list = await fetchInvoices(request, token);
  const match = list.items.find((item) => pattern.test(item.attachmentName));
  if (!match) {
    throw new Error(`No invoice found for pattern ${pattern}.`);
  }

  const detail = await fetchInvoiceDetail(request, match._id, token);
  const firstReadableBlock = detail.ocrBlocks?.find((block) => block.text.trim().length >= 3);
  if (!firstReadableBlock) {
    throw new Error(`Invoice '${detail.attachmentName}' has no readable OCR blocks for overlay validation.`);
  }

  if (!detail.parsed?.vendorName) {
    const seededVendor = firstReadableBlock.text
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .slice(0, 4)
      .join(" ");

      const patch = await request.patch(`${apiBaseUrl}/api/invoices/${detail._id}`, {
        headers: authHeaders(token),
        data: {
          parsed: { vendorName: seededVendor },
          updatedBy: "frontend-e2e"
        }
      });
      expect(patch.ok()).toBeTruthy();
    return fetchInvoiceDetail(request, detail._id, token);
  }

  return detail;
}

async function fetchInvoiceDetail(request: APIRequestContext, id: string, token: string): Promise<InvoiceDetailResponse> {
  const response = await request.get(`${apiBaseUrl}/api/invoices/${id}`, {
    headers: authHeaders(token)
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as InvoiceDetailResponse;
}

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function seedAuthToken(page: Page, token: string): Promise<void> {
  await page.addInitScript((value) => {
    window.localStorage.setItem("invoice_processor_session_token", value);
  }, token);
}

async function createE2ESessionToken(apiRoot: string): Promise<string> {
  const response = await axios.post<{ token?: string }>(
    `${apiRoot}/auth/token`,
    {
      email: loginEmail,
      password: loginPassword
    },
    {
      timeout: 30_000,
      validateStatus: () => true
    }
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
