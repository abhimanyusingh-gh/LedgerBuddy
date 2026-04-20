import {
  normalizeClassification,
  mergeClassification
} from "@/ai/extractors/invoice/stages/provenance";

describe("SLM Classification", () => {
  describe("normalizeClassification with glCategory", () => {
    it.each<{ name: string; input: unknown }>([
      { name: "null", input: null },
      { name: "string", input: "string" },
      { name: "number", input: 42 },
      { name: "array", input: [] },
    ])("returns undefined for non-object input ($name)", ({ input }) => {
      expect(normalizeClassification(input)).toBeUndefined();
    });

    it("extracts glCategory from classification object", () => {
      const result = normalizeClassification({
        invoiceType: "service",
        glCategory: "Professional Services"
      });
      expect(result).toEqual({
        invoiceType: "service",
        glCategory: "Professional Services"
      });
    });

    it("handles gl_category alias", () => {
      const result = normalizeClassification({
        gl_category: "Rent"
      });
      expect(result).toEqual({
        glCategory: "Rent"
      });
    });

    it("prefers glCategory over gl_category", () => {
      const result = normalizeClassification({
        glCategory: "Utilities",
        gl_category: "Rent"
      });
      expect(result).toEqual({
        glCategory: "Utilities"
      });
    });

    it("returns all classification fields when present", () => {
      const result = normalizeClassification({
        invoiceType: "purchase",
        category: "goods",
        glCategory: "Raw Materials",
        tdsSection: "194C"
      });
      expect(result).toEqual({
        invoiceType: "purchase",
        category: "goods",
        glCategory: "Raw Materials",
        tdsSection: "194C"
      });
    });
  });

  describe("mergeClassification preserves glCategory", () => {
    it("preserves glCategory from base classification and adds tdsSection", () => {
      const result = mergeClassification(
        { invoiceType: "service", glCategory: "Professional Services" },
        "194J"
      );
      expect(result).toEqual({
        invoiceType: "service",
        glCategory: "Professional Services",
        tdsSection: "194J"
      });
    });
  });
});
