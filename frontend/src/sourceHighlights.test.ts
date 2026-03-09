import { getInvoiceSourceHighlights } from "./sourceHighlights";
import type { Invoice } from "./types";

const baseInvoice: Invoice = {
  _id: "inv-1",
  tenantId: "tenant-a",
  workloadTier: "standard",
  sourceType: "folder",
  sourceKey: "local-folder",
  sourceDocumentId: "invoice-1.png",
  attachmentName: "invoice-1.png",
  mimeType: "image/png",
  receivedAt: "2026-02-24T00:00:00.000Z",
  confidenceScore: 92,
  confidenceTone: "green",
  autoSelectForApproval: true,
  riskFlags: [],
  riskMessages: [],
  status: "PARSED",
  processingIssues: [],
  createdAt: "2026-02-24T00:00:00.000Z",
  updatedAt: "2026-02-24T00:00:00.000Z",
  parsed: {
    vendorName: "Acme Corp",
    invoiceNumber: "INV-42",
    totalAmountMinor: 125000,
    currency: "USD"
  }
};

describe("getInvoiceSourceHighlights", () => {
  it("uses field provenance metadata when present", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      metadata: {
        fieldProvenance: JSON.stringify({
          vendorName: {
            source: "slm",
            page: 1,
            bbox: [100, 120, 380, 180],
            bboxNormalized: [0.1, 0.12, 0.38, 0.18]
          }
        }),
        fieldConfidence: JSON.stringify({
          vendorName: 0.94
        })
      }
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const vendor = highlights.find((entry) => entry.fieldKey === "vendorName");

    expect(vendor).toBeDefined();
    expect(vendor).toEqual(
      expect.objectContaining({
        source: "slm",
        page: 1,
        bboxNormalized: [0.1, 0.12, 0.38, 0.18],
        confidence: 0.94
      })
    );
  });

  it("falls back to OCR block matching and page normalization", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      ocrBlocks: [
        {
          text: "INV-42",
          page: 1,
          bbox: [220, 90, 420, 130],
          cropPath: "/tmp/billforge-artifacts/tenant-a/local-folder/hash/ocr-blocks/page-1/block-1.png"
        },
        {
          text: "Acme Corp",
          page: 1,
          bbox: [60, 40, 280, 80]
        }
      ]
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const invoiceNumber = highlights.find((entry) => entry.fieldKey === "invoiceNumber");

    expect(invoiceNumber).toBeDefined();
    expect(invoiceNumber?.bbox).toEqual([220, 90, 420, 130]);
    expect(invoiceNumber?.bboxNormalized[0]).toBeGreaterThan(0.5);
    expect(invoiceNumber?.bboxNormalized[2]).toBeLessThanOrEqual(1);
    expect(invoiceNumber?.cropPath).toContain("ocr-blocks");
    expect(typeof invoiceNumber?.blockIndex).toBe("number");
  });

  it("uses bboxModel when normalized box is unavailable", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      metadata: {
        fieldProvenance: JSON.stringify({
          invoiceNumber: {
            source: "heuristic",
            page: 1,
            bboxModel: [120, 90, 700, 220]
          }
        })
      }
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const invoiceNumber = highlights.find((entry) => entry.fieldKey === "invoiceNumber");

    expect(invoiceNumber).toBeDefined();
    expect(invoiceNumber?.bbox).toEqual([120, 90, 700, 220]);
    expect(invoiceNumber?.bboxNormalized[0]).toBeCloseTo(120 / 999, 3);
    expect(invoiceNumber?.bboxNormalized[2]).toBeCloseTo(700 / 999, 3);
  });

  it("falls back to normalizeBoxWithinPage when provenance has only pixel bbox", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      ocrBlocks: [
        { text: "Acme Corp", page: 1, bbox: [60, 40, 280, 80] },
        { text: "INV-42", page: 1, bbox: [220, 90, 420, 130] }
      ],
      metadata: {
        fieldProvenance: JSON.stringify({
          vendorName: {
            source: "heuristic",
            page: 1,
            bbox: [60, 40, 280, 80]
          }
        })
      }
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const vendor = highlights.find((entry) => entry.fieldKey === "vendorName");

    expect(vendor).toBeDefined();
    expect(vendor!.bboxNormalized[0]).toBeGreaterThanOrEqual(0);
    expect(vendor!.bboxNormalized[2]).toBeLessThanOrEqual(1);
    expect(vendor!.bboxNormalized[3]).toBeLessThanOrEqual(1);
  });

  it("clamps out-of-range bboxNormalized values to [0,1]", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      metadata: {
        fieldProvenance: JSON.stringify({
          vendorName: {
            source: "heuristic",
            page: 1,
            bbox: [100, 120, 380, 180],
            bboxNormalized: [-0.05, 0.12, 1.05, 0.18]
          }
        })
      }
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const vendor = highlights.find((entry) => entry.fieldKey === "vendorName");

    expect(vendor).toBeDefined();
    expect(vendor!.bboxNormalized[0]).toBeGreaterThanOrEqual(0);
    expect(vendor!.bboxNormalized[2]).toBeLessThanOrEqual(1);
  });

  it("produces normalized values in [0,1] from model box coordinates", () => {
    const invoice: Invoice = {
      ...baseInvoice,
      metadata: {
        fieldProvenance: JSON.stringify({
          totalAmountMinor: {
            source: "heuristic",
            page: 1,
            bboxModel: [500, 200, 800, 400]
          }
        })
      }
    };

    const highlights = getInvoiceSourceHighlights(invoice);
    const total = highlights.find((entry) => entry.fieldKey === "totalAmountMinor");

    expect(total).toBeDefined();
    for (const val of total!.bboxNormalized) {
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThanOrEqual(1);
    }
    expect(total!.bboxNormalized[0]).toBeCloseTo(500 / 999, 3);
    expect(total!.bboxNormalized[2]).toBeCloseTo(800 / 999, 3);
  });
});
