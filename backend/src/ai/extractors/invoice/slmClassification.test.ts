import {
  normalizeClassification,
  mergeClassification
} from "./stages/provenance";

describe("SLM Classification", () => {
  describe("normalizeClassification with glCategory", () => {
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

    it("returns undefined when all fields are empty", () => {
      const result = normalizeClassification({
        invoiceType: "",
        glCategory: "",
        category: ""
      });
      expect(result).toBeUndefined();
    });

    it("returns undefined for null input", () => {
      expect(normalizeClassification(null)).toBeUndefined();
    });

    it("returns undefined for non-object input", () => {
      expect(normalizeClassification("string")).toBeUndefined();
      expect(normalizeClassification(42)).toBeUndefined();
      expect(normalizeClassification([])).toBeUndefined();
    });

    it("trims whitespace from glCategory", () => {
      const result = normalizeClassification({
        glCategory: "  Software Subscription  "
      });
      expect(result).toEqual({
        glCategory: "Software Subscription"
      });
    });
  });

  describe("mergeClassification preserves glCategory", () => {
    it("preserves glCategory from base classification", () => {
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

    it("returns base with glCategory when no tdsSection", () => {
      const result = mergeClassification(
        { glCategory: "Rent" },
        null
      );
      expect(result).toEqual({
        glCategory: "Rent"
      });
    });
  });
});
