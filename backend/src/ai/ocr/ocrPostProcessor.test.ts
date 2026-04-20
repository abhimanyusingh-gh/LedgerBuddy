import { mergeBlocks, buildLines, buildLayoutText } from "@/ai/ocr/ocrPostProcessor.ts";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.ts";

function makeBlock(
  text: string,
  bbox: [number, number, number, number],
  page = 1
): OcrBlock {
  return { text, page, bbox: [0, 0, 0, 0], bboxNormalized: bbox };
}

describe("mergeBlocks", () => {
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
});

describe("buildLines", () => {
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

  it.each<{
    name: string;
    blocks: Array<{ text: string; xStart: number; xEnd: number; y?: number }>;
    expected: string;
  }>([
    {
      name: "wide-gap columns → pipe separator",
      blocks: [
        { text: "Invoice", xStart: 0.0, xEnd: 0.2 },
        { text: "12345", xStart: 0.7, xEnd: 0.9 }
      ],
      expected: "Invoice | 12345"
    },
    {
      name: "narrow column gap (> 0.02) → pipe separator",
      blocks: [
        { text: "Address text", xStart: 0.0, xEnd: 0.35 },
        { text: "RS-25-26-1148", xStart: 0.38, xEnd: 0.58 }
      ],
      expected: "Address text | RS-25-26-1148"
    },
    {
      name: "gap <= 0.02 (same word) → space",
      blocks: [
        { text: "hello", xStart: 0.0, xEnd: 0.20 },
        { text: "world", xStart: 0.21, xEnd: 0.40 }
      ],
      expected: "hello world"
    }
  ])("pipe-separator gap threshold: $name", ({ blocks, expected }) => {
    const merged = blocks.map((b, i) => ({
      text: b.text,
      page: 1,
      blockIndices: [i],
      bboxNormalized: [b.xStart, b.y ?? 0.10, b.xEnd, (b.y ?? 0.10) + 0.04] as [number, number, number, number]
    }));
    const result = buildLines(merged);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(expected);
  });

  it("adaptive tolerance groups slightly offset rows", () => {
    const blocks = [
      { text: "Left", page: 1, blockIndices: [0], bboxNormalized: [0.0, 0.10, 0.2, 0.14] as [number, number, number, number] },
      { text: "Right", page: 1, blockIndices: [1], bboxNormalized: [0.3, 0.118, 0.5, 0.158] as [number, number, number, number] }
    ];
    const result = buildLines(blocks);
    expect(result).toHaveLength(1);
  });
});


describe("buildLayoutText", () => {
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
