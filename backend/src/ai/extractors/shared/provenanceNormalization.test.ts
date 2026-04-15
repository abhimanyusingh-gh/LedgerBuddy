import { normalizeProvenanceEntry, normalizeFieldProvenance } from "@/ai/extractors/shared/provenanceNormalization";

describe("provenanceNormalization", () => {
  describe("normalizeProvenanceEntry", () => {
    it("returns undefined for null", () => {
      expect(normalizeProvenanceEntry(null)).toBeUndefined();
    });

    it("returns undefined for non-object", () => {
      expect(normalizeProvenanceEntry("string")).toBeUndefined();
      expect(normalizeProvenanceEntry(42)).toBeUndefined();
      expect(normalizeProvenanceEntry(true)).toBeUndefined();
    });

    it("returns undefined for array", () => {
      expect(normalizeProvenanceEntry([1, 2, 3, 4])).toBeUndefined();
    });

    it("returns undefined when no bbox fields resolve", () => {
      expect(normalizeProvenanceEntry({ source: "slm" })).toBeUndefined();
    });

    it("returns undefined for invalid bbox tuples", () => {
      expect(normalizeProvenanceEntry({ bbox: [10, 10, 5, 5] })).toBeUndefined();
    });

    it("normalizes a valid entry with bbox", () => {
      const result = normalizeProvenanceEntry({
        source: "slm",
        page: 1,
        bbox: [10, 20, 100, 200],
        blockIndex: 3,
        confidence: 0.95
      });
      expect(result).toEqual({
        source: "slm",
        page: 1,
        bbox: [10, 20, 100, 200],
        blockIndex: 3,
        confidence: 0.95
      });
    });

    it("normalizes a valid entry with bboxNormalized", () => {
      const result = normalizeProvenanceEntry({
        bboxNormalized: [0.1, 0.2, 0.5, 0.8],
        page: 2
      });
      expect(result).toEqual({
        page: 2,
        bboxNormalized: [0.1, 0.2, 0.5, 0.8]
      });
    });

    it("normalizes a valid entry with bboxModel", () => {
      const result = normalizeProvenanceEntry({
        bboxModel: [10, 20, 100, 200]
      });
      expect(result).toEqual({
        bboxModel: [10, 20, 100, 200]
      });
    });

    it("converts confidence > 1 to 0-1 range", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        confidence: 95
      });
      expect(result!.confidence).toBe(0.95);
    });

    it("clamps confidence to [0,1]", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        confidence: 150
      });
      expect(result!.confidence).toBeLessThanOrEqual(1);
    });

    it("accepts block_index alias", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        block_index: 7
      });
      expect(result!.blockIndex).toBe(7);
    });

    it("trims source string", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        source: "  slm  "
      });
      expect(result!.source).toBe("slm");
    });

    it("omits empty source", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        source: "  "
      });
      expect(result!.source).toBeUndefined();
    });

    it("omits non-positive page", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        page: 0
      });
      expect(result!.page).toBeUndefined();
    });

    it("rounds page to integer", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        page: 2.7
      });
      expect(result!.page).toBe(3);
    });

    it("omits negative blockIndex", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        blockIndex: -1
      });
      expect(result!.blockIndex).toBeUndefined();
    });

    it("omits NaN confidence", () => {
      const result = normalizeProvenanceEntry({
        bbox: [10, 20, 100, 200],
        confidence: "bad"
      });
      expect(result!.confidence).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
      expect(normalizeProvenanceEntry(undefined)).toBeUndefined();
    });
  });

  describe("normalizeFieldProvenance", () => {
    it("returns undefined for null", () => {
      expect(normalizeFieldProvenance(null)).toBeUndefined();
    });

    it("returns undefined for non-object", () => {
      expect(normalizeFieldProvenance("string")).toBeUndefined();
    });

    it("returns undefined for array", () => {
      expect(normalizeFieldProvenance([])).toBeUndefined();
    });

    it("returns undefined when all entries fail normalization", () => {
      expect(normalizeFieldProvenance({
        invoiceNumber: { source: "slm" },
        vendorName: null
      })).toBeUndefined();
    });

    it("normalizes a map of field provenance entries", () => {
      const result = normalizeFieldProvenance({
        invoiceNumber: {
          source: "slm",
          bbox: [10, 20, 100, 200],
          page: 1,
          confidence: 0.9
        },
        vendorName: {
          bboxNormalized: [0.1, 0.2, 0.5, 0.8],
          page: 1
        }
      });
      expect(result).toEqual({
        invoiceNumber: {
          source: "slm",
          bbox: [10, 20, 100, 200],
          page: 1,
          confidence: 0.9
        },
        vendorName: {
          bboxNormalized: [0.1, 0.2, 0.5, 0.8],
          page: 1
        }
      });
    });

    it("filters out invalid entries while keeping valid ones", () => {
      const result = normalizeFieldProvenance({
        invoiceNumber: {
          bbox: [10, 20, 100, 200],
          page: 1
        },
        vendorName: null,
        totalAmountMinor: "bad"
      });
      expect(result).toEqual({
        invoiceNumber: {
          bbox: [10, 20, 100, 200],
          page: 1
        }
      });
    });

    it("returns undefined for undefined input", () => {
      expect(normalizeFieldProvenance(undefined)).toBeUndefined();
    });

    it("returns undefined for empty object", () => {
      expect(normalizeFieldProvenance({})).toBeUndefined();
    });
  });
});
