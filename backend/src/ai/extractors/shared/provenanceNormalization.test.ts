import { normalizeProvenanceEntry, normalizeFieldProvenance } from "@/ai/extractors/shared/provenanceNormalization";

describe("provenanceNormalization", () => {
  describe("normalizeProvenanceEntry", () => {
    it.each<{ name: string; input: unknown }>([
      { name: "null", input: null },
      { name: "undefined", input: undefined },
      { name: "string", input: "string" },
      { name: "number", input: 42 },
      { name: "boolean", input: true },
      { name: "array", input: [1, 2, 3, 4] },
      { name: "object without bbox fields", input: { source: "slm" } },
      { name: "object with invalid bbox tuple", input: { bbox: [10, 10, 5, 5] } },
    ])("returns undefined for $name", ({ input }) => {
      expect(normalizeProvenanceEntry(input)).toBeUndefined();
    });

    it.each<{ name: string; bboxKey: "bbox" | "bboxNormalized" | "bboxModel"; value: number[] }>([
      { name: "bbox", bboxKey: "bbox", value: [10, 20, 100, 200] },
      { name: "bboxNormalized", bboxKey: "bboxNormalized", value: [0.1, 0.2, 0.5, 0.8] },
      { name: "bboxModel", bboxKey: "bboxModel", value: [10, 20, 100, 200] },
    ])("normalizes a valid entry with $name", ({ bboxKey, value }) => {
      const result = normalizeProvenanceEntry({ [bboxKey]: value });
      expect(result).toEqual({ [bboxKey]: value });
    });

    it.each<{ name: string; input: number; expected: (c: number | undefined) => void }>([
      { name: "scales confidence > 1 to 0-1 range", input: 95, expected: (c) => expect(c).toBe(0.95) },
      { name: "clamps confidence to [0,1]", input: 150, expected: (c) => expect(c).toBeLessThanOrEqual(1) },
    ])("$name", ({ input, expected }) => {
      const result = normalizeProvenanceEntry({ bbox: [10, 20, 100, 200], confidence: input });
      expected(result!.confidence);
    });

    it("accepts block_index alias", () => {
      const result = normalizeProvenanceEntry({ bbox: [10, 20, 100, 200], block_index: 7 });
      expect(result!.blockIndex).toBe(7);
    });

    it("trims source string", () => {
      const result = normalizeProvenanceEntry({ bbox: [10, 20, 100, 200], source: "  slm  " });
      expect(result!.source).toBe("slm");
    });

    it("normalizes a fully populated entry", () => {
      const result = normalizeProvenanceEntry({
        source: "slm",
        page: 1,
        bbox: [10, 20, 100, 200],
        blockIndex: 3,
        confidence: 0.95,
      });
      expect(result).toEqual({
        source: "slm",
        page: 1,
        bbox: [10, 20, 100, 200],
        blockIndex: 3,
        confidence: 0.95,
      });
    });
  });

  describe("normalizeFieldProvenance", () => {
    it.each<{ name: string; input: unknown }>([
      { name: "null", input: null },
      { name: "undefined", input: undefined },
      { name: "non-object", input: "string" },
      { name: "array", input: [] },
      { name: "empty object", input: {} },
      {
        name: "map where every entry fails normalization",
        input: { invoiceNumber: { source: "slm" }, vendorName: null },
      },
    ])("returns undefined for $name", ({ input }) => {
      expect(normalizeFieldProvenance(input)).toBeUndefined();
    });

    it("filters out invalid entries while keeping valid ones", () => {
      const result = normalizeFieldProvenance({
        invoiceNumber: { bbox: [10, 20, 100, 200], page: 1 },
        vendorName: null,
        totalAmountMinor: "bad",
      });
      expect(result).toEqual({
        invoiceNumber: { bbox: [10, 20, 100, 200], page: 1 },
      });
    });
  });
});
