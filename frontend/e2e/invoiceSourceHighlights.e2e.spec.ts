import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const skipIngest = process.env.E2E_SKIP_INGEST === "true";
const expectedTotalFiles = Number(process.env.E2E_EXPECT_TOTAL_FILES ?? "3");

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
  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);

    if (!skipIngest) {
      const ingestion = await triggerAndWaitForIngestion(request);
      expect(ingestion.totalFiles).toBe(expectedTotalFiles);
      expect(ingestion.processedFiles).toBe(expectedTotalFiles);
      expect(ingestion.failures).toBe(0);
    }

    const list = await fetchInvoices(request);
    expect(list.total).toBe(expectedTotalFiles);
    expect(list.items.length).toBe(expectedTotalFiles);
  });

  test("jpg invoice exposes image preview + selectable bbox overlay", async ({ page, request }) => {
    const invoice = await resolveInvoiceByExtension(request, /.+\.(jpg|jpeg)$/i);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });

  test("shows button to trigger email XOAUTH2 simulation workflow", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Ops Console" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Run Email XOAUTH2 Simulation" })).toBeVisible();
  });

  test("png invoice exposes image preview + selectable bbox overlay", async ({ page, request }) => {
    const invoice = await resolveInvoiceByExtension(request, /.+\.png$/i);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });

  test("pdf invoice exposes rendered 300 dpi image preview + selectable bbox overlay", async ({ page, request }) => {
    const invoice = await resolveInvoiceByExtension(request, /.+\.pdf$/i);
    await verifyInvoiceOverlayFlow(page, invoice.attachmentName);
  });
});

async function verifyInvoiceOverlayFlow(page: Page, attachmentName: string): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Ops Console" })).toBeVisible();

  const row = page
    .locator("tbody tr")
    .filter({ has: page.getByRole("button", { name: attachmentName }) })
    .first();
  await expect(row).toBeVisible();
  await row.click();

  const detailsPanel = page.locator(".detail-panel");
  await expect(detailsPanel.getByRole("heading", { name: "Value Source Highlights" })).toHaveCount(0);

  await row.locator("button.file-label").click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Value Source Highlights" })).toHaveCount(0);
  const revealButton = dialog.getByRole("button", { name: "Show Value Source Highlights" });
  await expect(revealButton).toBeVisible();
  await revealButton.click();

  await expect(dialog.getByRole("heading", { name: "Value Source Highlights" })).toBeVisible();
  await expect(dialog.locator(".source-preview-image img")).toBeVisible();
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

async function triggerAndWaitForIngestion(request: APIRequestContext): Promise<IngestionStatusResponse> {
  const trigger = await request.post(`${apiBaseUrl}/api/jobs/ingest`);
  expect(trigger.status()).toBe(202);

  const startedAt = Date.now();
  const timeoutMs = 20 * 60_000;
  while (Date.now() - startedAt < timeoutMs) {
    const statusResponse = await request.get(`${apiBaseUrl}/api/jobs/ingest/status`);
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

async function fetchInvoices(request: APIRequestContext): Promise<InvoiceListResponse> {
  const response = await request.get(`${apiBaseUrl}/api/invoices?page=1&limit=100`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as InvoiceListResponse;
}

async function resolveInvoiceByExtension(request: APIRequestContext, pattern: RegExp): Promise<InvoiceDetailResponse> {
  const list = await fetchInvoices(request);
  const match = list.items.find((item) => pattern.test(item.attachmentName));
  if (!match) {
    throw new Error(`No invoice found for pattern ${pattern}.`);
  }

  const detail = await fetchInvoiceDetail(request, match._id);
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
      data: {
        parsed: { vendorName: seededVendor },
        updatedBy: "frontend-e2e"
      }
    });
    expect(patch.ok()).toBeTruthy();
    return fetchInvoiceDetail(request, detail._id);
  }

  return detail;
}

async function fetchInvoiceDetail(request: APIRequestContext, id: string): Promise<InvoiceDetailResponse> {
  const response = await request.get(`${apiBaseUrl}/api/invoices/${id}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as InvoiceDetailResponse;
}
