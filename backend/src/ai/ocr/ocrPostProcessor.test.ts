import { mergeBlocks, buildLines, buildLayoutText, detectTables, normalizeValues } from "./ocrPostProcessor.ts";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.ts";

function makeBlock(
  text: string,
  bbox: [number, number, number, number],
  page = 1
): OcrBlock {
  return { text, page, bbox: [0, 0, 0, 0], bboxNormalized: bbox };
}

describe("mergeBlocks", () => {
  it("returns empty array when no blocks provided", () => {
    expect(mergeBlocks([])).toEqual([]);
  });

  it("skips blocks without bboxNormalized", () => {
    const block: OcrBlock = { text: "hello", page: 1, bbox: [0, 0, 100, 20] };
    expect(mergeBlocks([block])).toEqual([]);
  });

  it("merges two horizontally adjacent blocks on the same line", () => {
    const blockA = makeBlock("Invoice", [0.0, 0.1, 0.3, 0.15]);
    const blockB = makeBlock("No:", [0.305, 0.1, 0.5, 0.15]);
    const result = mergeBlocks([blockA, blockB]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Invoice No:");
    expect(result[0].blockIndices).toEqual([0, 1]);
  });

  it("does not merge blocks with horizontal gap >= 0.02", () => {
    const blockA = makeBlock("Left", [0.0, 0.1, 0.3, 0.15]);
    const blockB = makeBlock("Right", [0.32, 0.1, 0.6, 0.15]);
    const result = mergeBlocks([blockA, blockB]);
    expect(result).toHaveLength(2);
  });

  it("does not merge blocks with insufficient vertical overlap", () => {
    const blockA = makeBlock("Top", [0.0, 0.0, 0.5, 0.05]);
    const blockB = makeBlock("Bottom", [0.0, 0.08, 0.5, 0.13]);
    const result = mergeBlocks([blockA, blockB]);
    expect(result).toHaveLength(2);
  });

  it("fixes O->0 and l->1 inside numeric sequences", () => {
    const block = makeBlock("l2,O34", [0.0, 0.1, 0.3, 0.15]);
    const result = mergeBlocks([block]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("12,034");
  });

  it("does not corrupt non-numeric text", () => {
    const block = makeBlock("Hello World", [0.0, 0.1, 0.3, 0.15]);
    const result = mergeBlocks([block]);
    expect(result[0].text).toBe("Hello World");
  });

  it("does not mutate the original blocks array", () => {
    const block = makeBlock("Amount: 1,234.00", [0.0, 0.1, 0.5, 0.15]);
    const original = [...[block]];
    mergeBlocks([block]);
    expect(block.text).toBe("Amount: 1,234.00");
    expect([block]).toEqual(original);
  });
});

describe("buildLines", () => {
  it("returns empty array when no merged blocks provided", () => {
    expect(buildLines([])).toEqual([]);
  });

  it("groups blocks with close y-centers onto the same line", () => {
    const blocks = [
      { text: "Vendor", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.2, 0.14] as [number, number, number, number] },
      { text: "Name:", page: 1, blockIndices: [1], bboxNormalized: [0.21, 0.10, 0.4, 0.14] as [number, number, number, number] },
      { text: "ACME", page: 1, blockIndices: [2], bboxNormalized: [0.41, 0.11, 0.6, 0.14] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Vendor Name: ACME");
  });

  it("separates blocks on different lines", () => {
    const blocks = [
      { text: "Header", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.05, 0.5, 0.09] as [number, number, number, number] },
      { text: "Body", page: 1, blockIndices: [1], bboxNormalized: [0.0, 0.50, 0.5, 0.54] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(2);
  });

  it("sorts tokens by x position within a line", () => {
    const blocks = [
      { text: "Right", page: 1, blockIndices: [1], bboxNormalized: [0.7, 0.10, 0.9, 0.14] as [number, number, number, number] },
      { text: "Left", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.2, 0.14] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result[0].text).toBe("Left | Right");
  });

  it("buildLines: uses pipe separator for wide-gap columns", () => {
    const blocks = [
      { text: "Invoice", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.2, 0.14] as [number, number, number, number] },
      { text: "12345", page: 1, blockIndices: [1], bboxNormalized: [0.7, 0.10, 0.9, 0.14] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toContain(" | ");
  });

  it("buildLines: pipe separator for gap > 0.02 (narrow column gap)", () => {
    const blocks = [
      { text: "Address text", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.35, 0.14] as [number, number, number, number] },
      { text: "RS-25-26-1148", page: 1, blockIndices: [1], bboxNormalized: [0.38, 0.10, 0.58, 0.14] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Address text | RS-25-26-1148");
  });

  it("buildLines: no pipe separator for gap <= 0.02 (same word)", () => {
    const blocks = [
      { text: "hello", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.20, 0.14] as [number, number, number, number] },
      { text: "world", page: 1, blockIndices: [1], bboxNormalized: [0.21, 0.10, 0.40, 0.14] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("hello world");
  });

  it("buildLines: adaptive tolerance groups slightly offset rows", () => {
    const blocks = [
      { text: "Left", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.2, 0.14] as [number, number, number, number] },
      { text: "Right", page: 1, blockIndices: [1], bboxNormalized: [0.3, 0.118, 0.5, 0.158] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
  });
});

describe("detectTables", () => {
  it("returns empty array for empty input", () => {
    expect(detectTables([])).toEqual([]);
  });

  it("detects a basic 3-column 3-row table", () => {
    const tableLines = [
      {
        text: "Item Qty Amount",
        page: 1,
        blockIndices: [0],
        bboxNormalized: [0.0, 0.10, 1.0, 0.14] as [number, number, number, number]
      },
      {
        text: "Widget 10 500.00",
        page: 1,
        blockIndices: [1],
        bboxNormalized: [0.0, 0.15, 1.0, 0.19] as [number, number, number, number]
      },
      {
        text: "Gadget 5 250.00",
        page: 1,
        blockIndices: [2],
        bboxNormalized: [0.0, 0.20, 1.0, 0.24] as [number, number, number, number]
      }
    ];
    const result = detectTables(tableLines);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0].rows.length).toBeGreaterThanOrEqual(2);
    expect(result[0].rows[0].length).toBeGreaterThanOrEqual(2);
  });

  it("does not detect table from single row", () => {
    const singleLine = [
      {
        text: "Item Qty Amount",
        page: 1,
        blockIndices: [0],
        bboxNormalized: [0.0, 0.10, 1.0, 0.14] as [number, number, number, number]
      }
    ];
    const result = detectTables(singleLine);
    expect(result).toHaveLength(0);
  });
});

describe("normalizeValues", () => {
  it("converts Indian lakh format amount to minor units", () => {
    const blocks = [
      { text: "12,63,318", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.3, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    expect(result.amounts.length).toBeGreaterThanOrEqual(1);
    const found = result.amounts.find((a) => a.raw === "12,63,318");
    expect(found).toBeDefined();
    expect(found!.minorUnits).toBe(126331800);
  });

  it("parses DD-Mon-YY date format", () => {
    const blocks = [
      { text: "25-Jan-26", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.3, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    expect(result.dates.length).toBeGreaterThanOrEqual(1);
    const found = result.dates.find((d) => d.raw === "25-Jan-26");
    expect(found).toBeDefined();
    expect(found!.normalized).toBe("2026-01-25");
  });

  it("detects INR currency symbol", () => {
    const blocks = [
      { text: "Total ₹ 5,000.00", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.5, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    expect(result.currencies.length).toBeGreaterThanOrEqual(1);
    const found = result.currencies.find((c) => c.code === "INR");
    expect(found).toBeDefined();
    expect(found!.symbol).toBe("₹");
  });

  it("detects Rs currency symbol as INR", () => {
    const blocks = [
      { text: "Amount Rs 10,000", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.5, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    const found = result.currencies.find((c) => c.code === "INR");
    expect(found).toBeDefined();
  });

  it("parses YYYY-MM-DD date format", () => {
    const blocks = [
      { text: "Invoice Date: 2024-03-15", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.5, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    const found = result.dates.find((d) => d.normalized === "2024-03-15");
    expect(found).toBeDefined();
  });

  it("parses DD/MM/YYYY date format", () => {
    const blocks = [
      { text: "Date: 15/03/2024", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.5, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    const found = result.dates.find((d) => d.normalized === "2024-03-15");
    expect(found).toBeDefined();
  });

  it("converts simple decimal amount to minor units", () => {
    const blocks = [
      { text: "1,234.56", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.3, 0.15] as [number, number, number, number] }
    ];
    const result = normalizeValues(blocks);
    const found = result.amounts.find((a) => a.raw === "1,234.56");
    expect(found).toBeDefined();
    expect(found!.minorUnits).toBe(123456);
  });
});

describe("buildLayoutText", () => {
  it("returns empty string for no lines", () => {
    expect(buildLayoutText([])).toBe("");
  });

  it("joins lines within a page with newlines", () => {
    const lines = [
      { text: "Invoice #001", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.05, 0.4, 0.08] as [number, number, number, number] },
      { text: "Date: 2026-01-01", page: 1, blockIndices: [1], bboxNormalized: [0.0, 0.10, 0.4, 0.13] as [number, number, number, number] }
    ];
    const result = buildLayoutText(lines);
    expect(result).toBe("Invoice #001\nDate: 2026-01-01");
  });

  it("separates pages with a blank line", () => {
    const lines = [
      { text: "Page 1 content", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.05, 0.5, 0.08] as [number, number, number, number] },
      { text: "Page 2 content", page: 2, blockIndices: [1], bboxNormalized: [0.0, 0.05, 0.5, 0.08] as [number, number, number, number] }
    ];
    const result = buildLayoutText(lines);
    expect(result).toBe("Page 1 content\n\nPage 2 content");
  });

  it("preserves pipe separators from wide-column lines", () => {
    const lines = [
      { text: "CGST 9% | 8,505.00 | Total | 1,11,510.00", page: 1, blockIndices: [0, 1, 2, 3], bboxNormalized: [0.0, 0.5, 1.0, 0.54] as [number, number, number, number] }
    ];
    const result = buildLayoutText(lines);
    expect(result).toContain("|");
    expect(result).toContain("Total");
    expect(result).toContain("1,11,510.00");
  });

  it("filters structural-only tokens", () => {
    const lines = [
      { text: "table", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.1, 0.2, 0.15] as [number, number, number, number] },
      { text: "Invoice #123", page: 1, blockIndices: [1], bboxNormalized: [0.0, 0.2, 0.4, 0.25] as [number, number, number, number] }
    ];
    const result = buildLayoutText(lines);
    expect(result).toBe("Invoice #123");
  });
});
