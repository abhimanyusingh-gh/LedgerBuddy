import type { OcrBlock } from "../../../core/interfaces/OcrProvider.ts";
import type { OcrLine } from "../../../ocr/ocrPostProcessor.ts";
import { buildRankedOcrTextCandidates, normalizeOcrTextForSlm } from "./ocrTextCandidates.ts";

function makeBlock(text: string, bboxNormalized: [number, number, number, number], page = 1): OcrBlock {
  return {
    text,
    page,
    bbox: [0, 0, 100, 20],
    bboxNormalized
  };
}

function makeLine(text: string, bboxNormalized: [number, number, number, number], page = 1): OcrLine {
  return {
    text,
    page,
    blockIndices: [0],
    bboxNormalized
  };
}

describe("buildRankedOcrTextCandidates", () => {
  it("prefers layout-aware OCR text when it has better invoice signals", () => {
    const blocks = [
      makeBlock("Vendor", [0.05, 0.06, 0.2, 0.09]),
      makeBlock("Acme Pvt Ltd", [0.22, 0.06, 0.52, 0.09]),
      makeBlock("Invoice Number", [0.05, 0.12, 0.28, 0.15]),
      makeBlock("INV-26-001", [0.3, 0.12, 0.48, 0.15]),
      makeBlock("Total Amount", [0.05, 0.2, 0.25, 0.23]),
      makeBlock("1,234.56", [0.75, 0.2, 0.92, 0.23])
    ];

    const lines = [
      makeLine("Vendor | Acme Pvt Ltd", [0.05, 0.06, 0.52, 0.09]),
      makeLine("Invoice Number | INV-26-001", [0.05, 0.12, 0.48, 0.15]),
      makeLine("Total Amount | 1,234.56", [0.05, 0.2, 0.92, 0.23])
    ];

    const ranked = buildRankedOcrTextCandidates({
      rawText: "%%%%\ninvoice ???\n....",
      blocks,
      layoutLines: lines,
      enableKeyValueGrounding: true
    });

    expect(ranked.primary.text).toContain("Invoice Number");
    expect(ranked.primary.text).toContain("1,234.56");
    expect(ranked.ranked.length).toBeGreaterThanOrEqual(2);
  });

  it("creates augmented context when key-value grounding is enabled", () => {
    const blocks = [
      makeBlock("Invoice Number", [0.05, 0.1, 0.2, 0.13]),
      makeBlock("INV-2026-88", [0.25, 0.1, 0.45, 0.13]),
      makeBlock("Date", [0.05, 0.15, 0.15, 0.18]),
      makeBlock("12-04-2026", [0.25, 0.15, 0.42, 0.18])
    ];

    const ranked = buildRankedOcrTextCandidates({
      rawText: "Invoice Number INV-2026-88",
      blocks,
      layoutLines: [],
      enableKeyValueGrounding: true
    });

    expect(ranked.keyValueText).toContain("Invoice Number");
    expect(ranked.augmentedText).toContain("Invoice Number");
    expect(ranked.ranked.some((candidate) => candidate.id === "augmented")).toBe(true);
  });
});

describe("normalizeOcrTextForSlm", () => {
  it("drops structural-noise lines and normalizes spacing", () => {
    const normalized = normalizeOcrTextForSlm(" table \nInvoice   Number\n|||\n  INV-1  \n");
    expect(normalized).toBe("Invoice Number\nINV-1");
  });
});
