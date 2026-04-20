import { buildFieldCropUrlMap, buildFieldOverlayUrlMap } from "@/lib/invoice/invoiceView";
import type { SourceHighlight } from "@/lib/invoice/sourceHighlights";

describe("invoiceView", () => {
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
    expect(map.invoiceNumber).toEqual({ type: "url", url: "invoice-1:2" });
    expect(map.vendorName).toBeUndefined();
  });

  it("falls back to bbox crop when blockIndex is absent but bboxNormalized and page resolver exist", () => {
    const highlights = [
      {
        fieldKey: "invoiceNumber",
        label: "Invoice Number",
        value: "INV-1",
        source: "ocr",
        page: 2,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.2, 0.5, 0.6] as [number, number, number, number]
      }
    ] as SourceHighlight[];

    const map = buildFieldCropUrlMap(
      "invoice-1",
      highlights,
      (invoiceId, blockIndex) => `${invoiceId}:${blockIndex}`,
      (invoiceId, page) => `${invoiceId}/preview/${page}`
    );
    expect(map.invoiceNumber).toEqual({
      type: "bbox",
      pageImageUrl: "invoice-1/preview/2",
      bboxNormalized: [0.1, 0.2, 0.5, 0.6]
    });
  });

  it("prefers blockIndex crop over bbox crop when both are available", () => {
    const highlights = [
      {
        fieldKey: "invoiceNumber",
        label: "Invoice Number",
        value: "INV-1",
        source: "ocr",
        page: 1,
        bbox: [10, 10, 30, 30],
        bboxNormalized: [0.1, 0.1, 0.3, 0.3],
        blockIndex: 5,
        cropPath: "/tmp/crop.png"
      }
    ] as SourceHighlight[];

    const map = buildFieldCropUrlMap(
      "invoice-1",
      highlights,
      (invoiceId, blockIndex) => `${invoiceId}:${blockIndex}`,
      (invoiceId, page) => `${invoiceId}/preview/${page}`
    );
    expect(map.invoiceNumber).toEqual({ type: "url", url: "invoice-1:5" });
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
});
