import axios from "axios";
import { promises as fs } from "node:fs";
import path from "node:path";

const apiBaseUrl = process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:4000";
const frontendBaseUrl = process.env.E2E_FRONTEND_BASE_URL ?? "http://127.0.0.1:5173";
const ocrHealthUrl = process.env.E2E_OCR_HEALTH_URL ?? "http://127.0.0.1:8000/v1/health";
const slmHealthUrl = process.env.E2E_SLM_HEALTH_URL ?? "http://127.0.0.1:8100/v1/health";
const inboxDir =
  process.env.E2E_INBOX_DIR ?? path.resolve(process.cwd(), "..", "sample-invoices", "e2e-inbox");

const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 60_000,
  validateStatus: () => true
});

jest.setTimeout(20 * 60_000);

interface IngestStatus {
  state: "idle" | "running" | "completed" | "failed";
  running: boolean;
  totalFiles: number;
  processedFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
  error?: string;
}

interface InvoiceListResponse {
  total: number;
  page: number;
  limit: number;
  items: Array<{
    _id: string;
    attachmentName: string;
    status: string;
    ocrProvider?: string;
    ocrConfidence?: number;
    confidenceScore?: number;
    confidenceTone?: string;
    autoSelectForApproval?: boolean;
    parsed?: {
      invoiceNumber?: string;
      vendorName?: string;
      currency?: string;
      totalAmountMinor?: number;
    };
  }>;
}

interface InvoiceDetailResponse {
  _id: string;
  attachmentName: string;
  ocrBlocks?: Array<{
    text: string;
    cropPath?: string;
  }>;
  metadata?: Record<string, string>;
}

const SOURCE_OVERLAY_FIELDS = [
  "vendorName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "totalAmountMinor",
  "currency"
] as const;

const ALLOWED_STATUSES = new Set(["PARSED", "NEEDS_REVIEW", "FAILED_OCR", "FAILED_PARSE", "APPROVED", "EXPORTED"]);
const NON_FAILED_STATUSES = new Set(["PARSED", "NEEDS_REVIEW", "APPROVED", "EXPORTED"]);
const CONFIDENCE_TONES = new Set(["red", "yellow", "green"]);

describe("local full-stack ingestion e2e", () => {
  let expectedFiles: string[] = [];

  beforeAll(async () => {
    expectedFiles = await listInboxFiles(inboxDir);
    if (expectedFiles.length === 0) {
      throw new Error(`E2E inbox is empty: '${inboxDir}'`);
    }
    expect(expectedFiles.length).toBe(3);
    expect(expectedFiles.some((file) => /\.(jpg|jpeg)$/i.test(file))).toBe(true);
    expect(expectedFiles.some((file) => /\.png$/i.test(file))).toBe(true);
    expect(expectedFiles.some((file) => /\.pdf$/i.test(file))).toBe(true);

    const backendHealth = await api.get("/health");
    expect(backendHealth.status).toBe(200);
    expect(backendHealth.data?.ready).toBe(true);

    const frontend = await axios.get(frontendBaseUrl, { timeout: 30_000, responseType: "text" });
    expect(frontend.status).toBeGreaterThanOrEqual(200);
    expect(frontend.status).toBeLessThan(400);
    expect(typeof frontend.data).toBe("string");
    expect(frontend.data.toLowerCase()).toContain("<html");

    const [ocrHealth, slmHealth] = await Promise.all([
      axios.get(ocrHealthUrl, { timeout: 30_000 }),
      axios.get(slmHealthUrl, { timeout: 30_000 })
    ]);
    expect(ocrHealth.status).toBe(200);
    expect(ocrHealth.data?.modelLoaded).toBe(true);
    expect(slmHealth.status).toBe(200);
    expect(slmHealth.data?.modelLoaded).toBe(true);
  });

  it("processes all inbox files using live OCR + SLM through running backend", async () => {
    const trigger = await api.post("/api/jobs/ingest");
    expect(trigger.status).toBe(202);

    const completed = await waitForIngestionCompletion();
    expect(completed.state).toBe("completed");
    expect(completed.running).toBe(false);
    expect(completed.totalFiles).toBe(expectedFiles.length);
    expect(completed.processedFiles).toBe(expectedFiles.length);
    expect(completed.newInvoices + completed.failures + completed.duplicates).toBe(expectedFiles.length);

    const invoicesResponse = await api.get<InvoiceListResponse>("/api/invoices?page=1&limit=500");
    expect(invoicesResponse.status).toBe(200);
    const invoices = invoicesResponse.data.items;
    expect(invoices.length).toBe(expectedFiles.length);
    expect(invoicesResponse.data.total).toBe(expectedFiles.length);
    expect(invoices.every((invoice) => invoice.ocrProvider !== "mock")).toBe(true);

    const attachmentSet = new Set(invoices.map((invoice) => invoice.attachmentName));
    for (const fileName of expectedFiles) {
      expect(attachmentSet.has(fileName)).toBe(true);
    }

    expect(invoices.every((invoice) => ALLOWED_STATUSES.has(invoice.status))).toBe(true);

    const failedInvoices = invoices.filter((invoice) => !NON_FAILED_STATUSES.has(invoice.status));
    expect(failedInvoices).toHaveLength(0);

    let invoicesWithVendor = 0;
    let invoicesWithAmount = 0;
    let invoicesWithIdentifier = 0;
    let jpgCount = 0;
    let pngCount = 0;
    let pdfCount = 0;
    for (const invoice of invoices) {
      assertConfidenceSignals(invoice);
      const lowerName = invoice.attachmentName.toLowerCase();
      if (lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg")) {
        jpgCount += 1;
      } else if (lowerName.endsWith(".png")) {
        pngCount += 1;
      } else if (lowerName.endsWith(".pdf")) {
        pdfCount += 1;
      }
      if (hasNonEmptyText(invoice.parsed?.vendorName)) {
        invoicesWithVendor += 1;
      }
      if (isPositiveInteger(invoice.parsed?.totalAmountMinor)) {
        invoicesWithAmount += 1;
      }
      if (hasNonEmptyText(invoice.parsed?.invoiceNumber) || hasNonEmptyText(invoice.parsed?.currency)) {
        invoicesWithIdentifier += 1;
      }
    }

    expect(jpgCount).toBe(1);
    expect(pngCount).toBe(1);
    expect(pdfCount).toBe(1);
    expect(invoicesWithVendor).toBeGreaterThanOrEqual(2);
    expect(invoicesWithAmount).toBeGreaterThanOrEqual(2);
    expect(invoicesWithIdentifier).toBeGreaterThanOrEqual(1);

    const invoiceDetails = await Promise.all(
      invoices.map((invoice) => api.get<InvoiceDetailResponse>(`/api/invoices/${invoice._id}`))
    );
    invoiceDetails.forEach((response) => {
      expect(response.status).toBe(200);
      const detail = response.data;
      const blocks = detail.ocrBlocks ?? [];
      if (blocks.length === 0) {
        return;
      }
      const blocksWithCropPath = blocks.filter((block) => typeof block.cropPath === "string" && block.cropPath.length > 0);
      expect(blocksWithCropPath.length).toBeGreaterThan(0);
      expect(typeof detail.metadata?.ocrBlockCropCount).toBe("string");
      expect(typeof detail.metadata?.fieldOverlayPaths).toBe("string");
    });

    for (const response of invoiceDetails) {
      const detail = response.data;
      const overlayMap = parseStringMap(detail.metadata?.fieldOverlayPaths);
      const firstField = SOURCE_OVERLAY_FIELDS.find((field) => typeof overlayMap[field] === "string");
      if (!firstField) {
        continue;
      }

      const overlayResponse = await api.get(`/api/invoices/${detail._id}/source-overlays/${firstField}`);
      expect(overlayResponse.status).toBe(200);
      expect(String(overlayResponse.headers["content-type"] ?? "")).toContain("image/");
    }
  });

  it("uses checkpointing to skip already processed files on rerun", async () => {
    const trigger = await api.post("/api/jobs/ingest");
    expect(trigger.status).toBe(202);

    const rerun = await waitForIngestionCompletion();
    expect(rerun.state).toBe("completed");
    expect(rerun.totalFiles).toBe(0);
    expect(rerun.processedFiles).toBe(0);
    expect(rerun.newInvoices).toBe(0);
    expect(rerun.failures).toBe(0);

    const invoicesResponse = await api.get<InvoiceListResponse>("/api/invoices?page=1&limit=500");
    expect(invoicesResponse.status).toBe(200);
    expect(invoicesResponse.data.total).toBe(expectedFiles.length);
  });

  it("changes NEEDS_REVIEW invoices to APPROVED via API", async () => {
    const listResponse = await api.get<InvoiceListResponse>("/api/invoices?page=1&limit=500&status=NEEDS_REVIEW");
    expect(listResponse.status).toBe(200);
    const target = listResponse.data.items[0];
    if (!target) {
      return;
    }

    const approve = await api.post("/api/invoices/approve", {
      ids: [target._id],
      approvedBy: "e2e-approver"
    });
    expect(approve.status).toBe(200);
    expect(Number(approve.data?.modifiedCount ?? 0)).toBeGreaterThanOrEqual(1);

    const updated = await api.get(`/api/invoices/${target._id}`);
    expect(updated.status).toBe(200);
    expect(updated.data?.status).toBe("APPROVED");
    expect(updated.data?.approval?.approvedBy).toBe("e2e-approver");
  });
});

async function listInboxFiles(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(pdf|png|jpe?g)$/i.test(name))
    .sort((left, right) => left.localeCompare(right));
}

async function waitForIngestionCompletion(timeoutMs = 20 * 60_000): Promise<IngestStatus> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const response = await api.get<IngestStatus>("/api/jobs/ingest/status");
    if (response.status !== 200) {
      throw new Error(`Status endpoint failed with HTTP ${response.status}.`);
    }

    const status = response.data;
    if (status.state === "failed") {
      throw new Error(`Ingestion job failed: ${status.error ?? "unknown error"}`);
    }
    if (status.state === "completed") {
      return status;
    }

    await sleep(2_000);
  }

  throw new Error(`Timed out waiting for ingestion completion after ${timeoutMs}ms.`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertConfidenceSignals(invoice: InvoiceListResponse["items"][number]): void {
  expect(isProbability(invoice.ocrConfidence)).toBe(true);
  expect(isPercentage(invoice.confidenceScore)).toBe(true);
  expect(CONFIDENCE_TONES.has(invoice.confidenceTone ?? "")).toBe(true);
  expect(typeof invoice.autoSelectForApproval).toBe("boolean");

  const score = invoice.confidenceScore as number;
  const expectedTone = score >= 91 ? "green" : score >= 80 ? "yellow" : "red";
  expect(invoice.confidenceTone).toBe(expectedTone);
  expect(invoice.autoSelectForApproval).toBe(score >= 91);
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

function parseStringMap(value: unknown): Record<string, string> {
  if (typeof value !== "string") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).filter(([, entry]) => typeof entry === "string" && entry.trim().length > 0)
  );
}
