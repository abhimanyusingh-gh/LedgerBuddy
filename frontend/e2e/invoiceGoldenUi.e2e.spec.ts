import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { formatMinorAmountWithCurrency } from "../src/lib/common/currency";
import {
  clickTab,
  expectBackendReady,
  loginPassword,
  loginViaUI,
  openInvoiceDetailsByFile,
  PERSONAS,
  setInvoicePageSize,
  uploadFilesViaUI,
  waitForInvoiceStatusByFile
} from "./helpers";

type GroundTruthEntry = {
  file: string;
  invoiceNumber?: string;
  vendorNameContains?: string;
  invoiceDate?: string;
  dueDate?: string;
  currency?: string;
  totalAmountMinor?: number;
  lineItemAmountsMinor?: number[];
  gst?: {
    subtotalMinor?: number;
    cgstMinor?: number;
    sgstMinor?: number;
    totalTaxMinor?: number;
  };
  fieldProvenance?: {
    invoiceNumber?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    vendorName?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    invoiceDate?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    dueDate?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    totalAmountMinor?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    gst?: {
      subtotalMinor?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
      cgstMinor?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
      sgstMinor?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
      totalTaxMinor?: { page: number; blockIndex: number; bboxNormalized: [number, number, number, number] };
    };
  };
};

const projectRoot = path.resolve(import.meta.dirname, "../..");
const inboxDir = path.join(projectRoot, "sample-invoices/inbox");
const tempUploadDir = path.join(projectRoot, ".local-run/playwright-golden");
const groundTruthPath = path.join(projectRoot, "sample-invoices/ground-truth.json");

function loadGroundTruth(): GroundTruthEntry[] {
  const parsed = JSON.parse(fs.readFileSync(groundTruthPath, "utf8")) as { files: GroundTruthEntry[] };
  return parsed.files;
}

function createTempCopies(entries: GroundTruthEntry[]): Array<GroundTruthEntry & { uploadPath: string; uploadFileName: string }> {
  fs.mkdirSync(tempUploadDir, { recursive: true });
  const prefix = `${Date.now()}-golden`;
  return entries.map((entry, index) => {
    const uploadFileName = `${prefix}-${String(index + 1).padStart(2, "0")}-${entry.file}`;
    const uploadPath = path.join(tempUploadDir, uploadFileName);
    fs.copyFileSync(path.join(inboxDir, entry.file), uploadPath);
    return { ...entry, uploadPath, uploadFileName };
  });
}

async function readExtractedFieldMap(page: Parameters<typeof test>[0]["page"]) {
  const table = page.locator("section.panel.detail-panel table.extracted-table").first();
  await expect(table).toBeVisible({ timeout: 10_000 });
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const result = new Map<string, string>();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const label = ((await row.locator("td").nth(0).textContent()) ?? "").trim();
    const value = ((await row.locator("td").nth(1).textContent()) ?? "").trim();
    if (label) {
      result.set(label, value);
    }
  }
  return result;
}

async function readLineItemAmounts(page: Parameters<typeof test>[0]["page"]) {
  const heading = page.getByRole("heading", { name: "Extracted Line Items" });
  if (!(await heading.isVisible({ timeout: 2_000 }).catch(() => false))) {
    return [];
  }
  const table = heading.locator("xpath=following-sibling::table[1]");
  const rows = table.locator("tbody tr");
  const count = await rows.count();
  const amounts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = ((await rows.nth(index).locator("td").nth(4).textContent()) ?? "").trim();
    if (value && value !== "-") {
      amounts.push(value);
    }
  }
  return amounts.sort();
}

async function expectFieldCropThumbnail(
  page: Parameters<typeof test>[0]["page"],
  label: string
) {
  const row = page
    .locator("section.panel.detail-panel table.extracted-table tbody tr")
    .filter({ has: page.getByRole("cell", { name: label, exact: true }) })
    .first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  await expect(row.locator("img.field-crop-thumbnail")).toBeVisible({ timeout: 10_000 });
}

async function ensureSourcePreviewOpen(page: Parameters<typeof test>[0]["page"]) {
  const detailsPanel = page.locator("section.panel.detail-panel");
  const revealButton = detailsPanel.getByRole("button", { name: /Show Source Preview|Hide Source Preview/ });
  await expect(revealButton).toBeVisible({ timeout: 10_000 });
  if ((await revealButton.textContent())?.includes("Show")) {
    await revealButton.click();
  }
  await expect(detailsPanel.getByRole("heading", { name: "Source Preview" })).toBeVisible({ timeout: 10_000 });
}

async function expectSourceHighlight(
  page: Parameters<typeof test>[0]["page"],
  label: string
) {
  const detailsPanel = page.locator("section.panel.detail-panel");
  const chip = detailsPanel.locator(".source-highlight-chip").filter({ hasText: label }).first();
  await expect(chip).toBeVisible({ timeout: 10_000 });
  await chip.click();
  await expect(detailsPanel.locator(".source-highlight-chip-active").filter({ hasText: label })).toBeVisible({
    timeout: 10_000
  });
  await expect(detailsPanel.locator(".source-preview-canvas, .source-preview-image img").first()).toBeVisible({
    timeout: 10_000
  });
}

async function expectGroundedUiForEntry(
  page: Parameters<typeof test>[0]["page"],
  entry: GroundTruthEntry
) {
  const provenance = entry.fieldProvenance;
  if (!provenance) {
    return;
  }

  const scalarChecks: Array<{ present: boolean; tableLabel: string; highlightLabel: string }> = [
    { present: !!provenance.invoiceNumber, tableLabel: "Invoice Number", highlightLabel: "Invoice Number" },
    { present: !!provenance.vendorName, tableLabel: "Vendor Name", highlightLabel: "Vendor" },
    { present: !!provenance.invoiceDate, tableLabel: "Invoice Date", highlightLabel: "Invoice Date" },
    { present: !!provenance.dueDate, tableLabel: "Due Date", highlightLabel: "Due Date" },
    { present: !!provenance.totalAmountMinor, tableLabel: "Total Amount", highlightLabel: "Total Amount" }
  ];

  const gstChecks: Array<{ present: boolean; tableLabel: string; highlightLabel: string }> = [
    { present: !!provenance.gst?.subtotalMinor, tableLabel: "Subtotal", highlightLabel: "Subtotal" },
    { present: !!provenance.gst?.cgstMinor, tableLabel: "CGST", highlightLabel: "CGST" },
    { present: !!provenance.gst?.sgstMinor, tableLabel: "SGST", highlightLabel: "SGST" },
    { present: !!provenance.gst?.totalTaxMinor, tableLabel: "Total Tax", highlightLabel: "Total Tax" }
  ];

  await ensureSourcePreviewOpen(page);

  for (const check of [...scalarChecks, ...gstChecks]) {
    if (!check.present) {
      continue;
    }
    await expectFieldCropThumbnail(page, check.tableLabel);
    await expectSourceHighlight(page, check.highlightLabel);
  }
}

test.describe.serial("Golden invoice values through UI uploads", () => {
  test.beforeAll(async ({ request }) => {
    await expectBackendReady(request);
  });

  test("uploading the full sample inbox shows golden invoice values in the UI", async ({ page }) => {
    test.setTimeout(45 * 60_000);

    const entries = createTempCopies(loadGroundTruth());

    await loginViaUI(page, PERSONAS.tenantAdmin.email, loginPassword);
    await clickTab(page, "Invoices");
    await setInvoicePageSize(page, 100);
    await uploadFilesViaUI(page, entries.map((entry) => entry.uploadPath));

    for (const entry of entries) {
      const status = await waitForInvoiceStatusByFile(
        page,
        entry.uploadFileName,
        /Processed|Needs Review|Approved|Step \d+/,
        8 * 60_000
      );
      expect(status).not.toMatch(/OCR Failed|Parse Failed/);
    }

    for (const entry of entries) {
      await clickTab(page, "Invoices");
      await setInvoicePageSize(page, 100);
      await openInvoiceDetailsByFile(page, entry.uploadFileName);

      const fields = await readExtractedFieldMap(page);

      if (entry.invoiceNumber) {
        await expect(fields.get("Invoice Number")).toBe(entry.invoiceNumber);
      }
      if (entry.vendorNameContains) {
        await expect(fields.get("Vendor Name") ?? "").toContain(entry.vendorNameContains);
      }
      if (entry.invoiceDate) {
        await expect(fields.get("Invoice Date")).toBe(entry.invoiceDate);
      }
      if (entry.dueDate) {
        await expect(fields.get("Due Date")).toBe(entry.dueDate);
      }
      if (entry.currency) {
        await expect(fields.get("Currency")).toBe(entry.currency);
      }
      if (typeof entry.totalAmountMinor === "number") {
        await expect(fields.get("Total Amount")).toBe(
          formatMinorAmountWithCurrency(entry.totalAmountMinor, entry.currency)
        );
      }
      if (entry.gst?.subtotalMinor !== undefined) {
        await expect(fields.get("Subtotal")).toBe(
          formatMinorAmountWithCurrency(entry.gst.subtotalMinor, entry.currency)
        );
      }
      if (entry.gst?.cgstMinor !== undefined) {
        await expect(fields.get("CGST")).toBe(
          formatMinorAmountWithCurrency(entry.gst.cgstMinor, entry.currency)
        );
      }
      if (entry.gst?.sgstMinor !== undefined) {
        await expect(fields.get("SGST")).toBe(
          formatMinorAmountWithCurrency(entry.gst.sgstMinor, entry.currency)
        );
      }
      if (entry.gst?.totalTaxMinor !== undefined) {
        await expect(fields.get("Total Tax")).toBe(
          formatMinorAmountWithCurrency(entry.gst.totalTaxMinor, entry.currency)
        );
      }

      if (entry.lineItemAmountsMinor && entry.lineItemAmountsMinor.length > 0) {
        const expectedLineItems = entry.lineItemAmountsMinor
          .map((amount) => formatMinorAmountWithCurrency(amount, entry.currency))
          .sort();
        await expect(await readLineItemAmounts(page)).toEqual(expectedLineItems);
      }

      await expectGroundedUiForEntry(page, entry);
    }
  });
});
