import {
  buildEditForm,
  buildFieldCropUrlMap,
  buildFieldOverlayUrlMap,
  normalizeAmountInput,
  normalizeTextInput
} from "./invoiceView";
import type { SourceHighlight } from "./sourceHighlights";
import type { Invoice } from "./types";

describe("invoiceView", () => {
  it("builds edit form from parsed fields", () => {
    const invoice = {
      parsed: {
        invoiceNumber: "INV-42",
        vendorName: "Acme",
        invoiceDate: "2026-02-26",
        dueDate: "2026-03-05",
        currency: "USD",
        totalAmountMinor: 12345
      }
    } as Invoice;

    const form = buildEditForm(invoice);
    expect(form.invoiceNumber).toBe("INV-42");
    expect(form.vendorName).toBe("Acme");
    expect(form.totalAmountMajor).toBe("123.45");
  });

  it("normalizes text and amount inputs", () => {
    expect(normalizeTextInput("  hello ")).toBe("hello");
    expect(normalizeTextInput("   ")).toBeNull();
    expect(normalizeAmountInput(" 42.10 ")).toBe("42.10");
    expect(normalizeAmountInput("")).toBeNull();
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
});
