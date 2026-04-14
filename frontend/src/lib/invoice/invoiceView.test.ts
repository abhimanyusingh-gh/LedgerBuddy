import {
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  normalizeInput,
  STATUS_LABELS,
  STATUSES
} from "@/lib/invoice/invoiceView";
import type { SourceHighlight } from "@/lib/invoice/sourceHighlights";

describe("invoiceView", () => {
  it("normalizes input, trimming whitespace and returning null for blanks", () => {
    expect(normalizeInput("  hello ")).toBe("hello");
    expect(normalizeInput("   ")).toBeNull();
    expect(normalizeInput(" 42.10 ")).toBe("42.10");
    expect(normalizeInput("")).toBeNull();
  });

  it("maps only valid field crop urls", () => {
    const highlights = [
      {
        fieldKey: "invoiceNumber",
        label: "Invoice Number",
        value: "INV-1",
        source: "ocr",
        page: 1,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.1, 0.3, 0.3],
        blockIndex: 2,
        cropPath: "/tmp/crop.png"
      },
      {
        fieldKey: "vendorName",
        label: "Vendor",
        value: "Acme",
        source: "ocr",
        page: 1,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.1, 0.3, 0.3]
      }
    ] as SourceHighlight[];

    const map = buildFieldCropUrlMap("invoice-1", highlights, (invoiceId, blockIndex) => `${invoiceId}:${blockIndex}`);
    expect(map.invoiceNumber).toBe("invoice-1:2");
    expect(map.vendorName).toBeUndefined();
  });

  it("maps only valid overlay urls", () => {
    const highlights = [
      {
        fieldKey: "currency",
        label: "Currency",
        value: "USD",
        source: "ocr",
        page: 1,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.1, 0.3, 0.3],
        overlayPath: "/tmp/overlay.png"
      },
      {
        fieldKey: "dueDate",
        label: "Due Date",
        value: "2026-02-28",
        source: "ocr",
        page: 1,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.1, 0.3, 0.3]
      }
    ] as SourceHighlight[];

    const map = buildFieldOverlayUrlMap("invoice-2", highlights, (invoiceId, fieldKey) => `${invoiceId}:${fieldKey}`);
    expect(map.currency).toBe("invoice-2:currency");
    expect(map.dueDate).toBeUndefined();
  });

  it("every STATUSES entry has a STATUS_LABELS key", () => {
    for (const status of STATUSES) {
      expect(STATUS_LABELS).toHaveProperty(status);
    }
  });
});
