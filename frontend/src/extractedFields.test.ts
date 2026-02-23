import { formatOcrConfidenceLabel, getExtractedFieldRows } from "./extractedFields.ts";
import type { Invoice } from "./types.ts";

const baseInvoice: Invoice = {
  _id: "invoice-1",
  tenantId: "tenant-a",
  workloadTier: "standard",
  sourceType: "email",
  sourceKey: "inbox",
  sourceDocumentId: "10",
  attachmentName: "invoice.pdf",
  mimeType: "application/pdf",
  receivedAt: "2026-02-19T00:00:00.000Z",
  confidenceScore: 95,
  confidenceTone: "green",
  autoSelectForApproval: true,
  riskFlags: [],
  riskMessages: [],
  status: "APPROVED",
  processingIssues: [],
  createdAt: "2026-02-19T00:00:00.000Z",
  updatedAt: "2026-02-19T00:00:00.000Z"
};

describe("extracted field helpers", () => {
  it("builds clear labeled rows for extracted values", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      ocrProvider: "deepseek",
      ocrConfidence: 0.93,
      metadata: {
        extractionSource: "ocr-provider",
        extractionStrategy: "best-candidate"
      },
      parsed: {
        invoiceNumber: "INV-42",
        vendorName: "Acme Corp",
        invoiceDate: "2026-02-01",
        dueDate: "2026-02-15",
        totalAmountMinor: 120050,
        currency: "USD"
      }
    };

    const rows = getExtractedFieldRows(invoice);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Invoice Number", value: "INV-42" }),
        expect.objectContaining({ label: "Vendor Name", value: "Acme Corp" }),
        expect.objectContaining({ label: "Total Amount", value: "USD 1200.50" }),
        expect.objectContaining({ label: "OCR Engine", value: "deepseek" }),
        expect.objectContaining({ label: "Extraction Source", value: "ocr-provider" }),
        expect.objectContaining({ label: "Extraction Strategy", value: "best-candidate" }),
        expect.objectContaining({ label: "OCR Confidence", value: "93%" })
      ])
    );
  });

  it("uses placeholders when extracted data is missing", () => {
    const rows = getExtractedFieldRows(baseInvoice);
    const rowMap = new Map(rows.map((row) => [row.label, row.value]));

    expect(rowMap.get("Invoice Number")).toBe("-");
    expect(rowMap.get("Total Amount")).toBe("-");
    expect(rowMap.get("OCR Confidence")).toBe("-");
  });

  it("formats OCR confidence consistently", () => {
    expect(formatOcrConfidenceLabel(0.876)).toBe("88%");
    expect(formatOcrConfidenceLabel(97)).toBe("97%");
    expect(formatOcrConfidenceLabel(undefined)).toBe("-");
  });
});
