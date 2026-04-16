import { formatOcrConfidenceLabel, getExtractedFieldRows } from "@/lib/invoice/extractedFields";
import type { SourceFieldKey } from "@/lib/invoice/sourceHighlights";
import type { Invoice } from "@/types";

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
  status: "APPROVED",
  processingIssues: [],
  createdAt: "2026-02-19T00:00:00.000Z",
  updatedAt: "2026-02-19T00:00:00.000Z"
};

describe("extracted field helpers", () => {
  it("builds clear labeled rows for extracted values", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      parsed: {
        invoiceNumber: "INV-42",
        vendorName: "Acme Corp",
        invoiceDate: "2026-02-01",
        dueDate: "2026-02-15",
        totalAmountMinor: 120050,
        currency: "USD",
        notes: ["first note", "second note"]
      }
    };

    const rows = getExtractedFieldRows(invoice);

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Invoice Number", value: "INV-42" }),
        expect.objectContaining({ label: "Vendor Name", value: "Acme Corp" }),
        expect.objectContaining({ label: "Total Amount", value: "$1,200.50" }),
        expect.objectContaining({ label: "Notes", value: "first note | second note" })
      ])
    );
  });

  it("uses placeholders when extracted data is missing", () => {
    const rows = getExtractedFieldRows(baseInvoice);
    const rowMap = new Map(rows.map((row) => [row.label, row.value]));

    expect(rowMap.get("Invoice Number")).toBe("-");
    expect(rowMap.get("Total Amount")).toBe("-");
    expect(rowMap.get("Notes")).toBe("-");
  });

  it("formats OCR confidence consistently", () => {
    expect(formatOcrConfidenceLabel(0.876)).toBe("88%");
    expect(formatOcrConfidenceLabel(97)).toBe("97%");
    expect(formatOcrConfidenceLabel(undefined)).toBe("-");
  });

  it("fieldKey values match SourceFieldKey union for crop URL lookup", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      parsed: {
        invoiceNumber: "INV-1",
        vendorName: "Acme",
        invoiceDate: "2026-01-01",
        dueDate: "2026-02-01",
        totalAmountMinor: 10000,
        currency: "INR",
        notes: []
      }
    };

    const rows = getExtractedFieldRows(invoice);
    const validKeys: ReadonlySet<string> = new Set<SourceFieldKey | "notes">([
      "invoiceNumber",
      "vendorName",
      "invoiceDate",
      "dueDate",
      "totalAmountMinor",
      "currency",
      "notes"
    ]);

    for (const row of rows) {
      expect(validKeys.has(row.fieldKey)).toBe(true);
    }
  });
});
