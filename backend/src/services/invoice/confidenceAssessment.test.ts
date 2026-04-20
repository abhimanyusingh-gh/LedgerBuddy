import { assessInvoiceConfidence, getConfidenceTone } from "@/services/invoice/confidenceAssessment.ts";
import type { ParsedInvoiceData } from "@/types/invoice.ts";

function fullParsed(overrides?: Partial<ParsedInvoiceData>): ParsedInvoiceData {
  return {
    invoiceNumber: "INV-001",
    vendorName: "ACME Corp",
    invoiceDate: new Date("2026-01-15"),
    totalAmountMinor: 50000,
    currency: "USD",
    ...overrides
  };
}

function assess(overrides?: Record<string, unknown>) {
  return assessInvoiceConfidence({
    ocrConfidence: 0.95,
    parsed: fullParsed(),
    warnings: [],
    autoSelectMin: 80,
    ...overrides
  });
}

describe("assessInvoiceConfidence", () => {
  describe("normalizeConfidence", () => {
    it.each([
      ["undefined defaults to 0.6", undefined, 0.6],
      ["NaN defaults to 0.6", NaN, 0.6],
      ["> 1 divided by 100 (95 → 0.95)", 95, 0.95],
      ["in [0,1] used as-is (0.85)", 0.85, 0.85],
      ["exactly 0 stays 0", 0, 0],
      ["exactly 1 stays 1", 1, 1],
      ["0.5 stays 0.5", 0.5, 0.5],
      ["150 divided to 1.5 and clamped to 1", 150, 1],
    ])("%s", (_label, input, expectedOcr) => {
      const result = assess({ ocrConfidence: input });
      const expectedScore = Math.round(expectedOcr * 100 * 0.65 + 100 * 0.35);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("scoreCompleteness", () => {
    it.each([
      ["all 5 required fields present", fullParsed(), 5],
      ["no required fields present", {} as ParsedInvoiceData, 0],
      ["partial fields (2/5)", { invoiceNumber: "INV-001", vendorName: "ACME" } as ParsedInvoiceData, 2],
      ["empty string values ignored", fullParsed({ invoiceNumber: "", vendorName: "" }), 3],
      ["null/undefined values ignored", fullParsed({ invoiceNumber: undefined, currency: undefined }), 3],
    ])("scores correctly when %s", (_label, parsed, presentCount) => {
      const result = assess({ parsed });
      const completeness = Math.round((presentCount / 5) * 100);
      const expectedScore = Math.round(95 * 0.65 + completeness * 0.35);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("warnings penalty", () => {
    it.each([
      ["0 warnings applies no penalty", 0, 0],
      ["1 warning applies 4 points", 1, 4],
      ["6 warnings applies 24 points", 6, 24],
      ["7 warnings caps at 25 (7*4=28 > 25)", 7, 25],
      ["10 warnings caps at 25", 10, 25],
    ])("%s", (_label, warningCount, expectedPenalty) => {
      const warnings = Array.from({ length: warningCount }, (_, i) => `warning ${i}`);
      const result = assess({ warnings });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - expectedPenalty);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("complianceRiskPenalty", () => {
    it.each([
      ["0", 0, 0],
      ["undefined", undefined, 0],
      ["15", 15, 15],
    ])("penalty=%s subtracts %s from score", (_label, penalty, expectedDeduction) => {
      const result = assess({ complianceRiskPenalty: penalty });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - expectedDeduction);
      expect(result.score).toBe(expectedScore);
    });

    it("clamps score at 0 when penalty exceeds raw score", () => {
      const result = assess({
        ocrConfidence: 0.1,
        parsed: {},
        warnings: Array.from({ length: 10 }, (_, i) => `w${i}`),
        complianceRiskPenalty: 30
      });
      expect(result.score).toBe(0);
    });
  });

  describe("autoSelectForApproval", () => {
    it("is true when score >= autoSelectMin", () => {
      const result = assess({ autoSelectMin: 50 });
      expect(result.autoSelectForApproval).toBe(true);
    });

    it("is false when score < autoSelectMin", () => {
      const result = assess({ autoSelectMin: 100, ocrConfidence: 0.5, parsed: {} });
      expect(result.autoSelectForApproval).toBe(false);
    });

    it("is true when score exactly equals autoSelectMin", () => {
      const score = Math.round(95 * 0.65 + 100 * 0.35);
      const result = assess({ autoSelectMin: score });
      expect(result.autoSelectForApproval).toBe(true);
    });

    it("defaults to 91 when autoSelectMin is undefined", () => {
      const result = assessInvoiceConfidence({
        ocrConfidence: 0.95,
        parsed: fullParsed(),
        warnings: []
      });
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
      expect(result.autoSelectForApproval).toBe(true);
    });
  });

  describe("score clamping", () => {
    it("clamps score at 0 for very bad input", () => {
      const warnings = Array.from({ length: 20 }, (_, i) => `w${i}`);
      const result = assess({
        ocrConfidence: 0,
        parsed: {},
        warnings,
        autoSelectMin: 80,
        complianceRiskPenalty: 30
      });
      expect(result.score).toBe(0);
    });

    it("clamps score at 100 for perfect input", () => {
      const result = assess({
        ocrConfidence: 1.0,
        parsed: fullParsed(),
        warnings: [],
        autoSelectMin: 80
      });
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("tone assignment", () => {
    it("returns green tone for high score", () => {
      const result = assess({ ocrConfidence: 1.0, warnings: [] });
      expect(result.tone).toBe("green");
    });

    it("returns yellow tone for medium score", () => {
      const result = assess({
        ocrConfidence: 0.95,
        warnings: ["w1", "w2", "w3"],
        parsed: fullParsed()
      });
      expect(result.tone).toBe("yellow");
    });

    it("returns red tone for low score", () => {
      const warnings = Array.from({ length: 7 }, (_, i) => `w${i}`);
      const result = assess({
        ocrConfidence: 0.5,
        warnings,
        parsed: {}
      });
      expect(result.tone).toBe("red");
    });
  });

  describe("tone derives from autoApprovalThreshold", () => {
    it("uses autoApprovalThreshold as green threshold", () => {
      const result = assess({ ocrConfidence: 1.0, warnings: [], autoApprovalThreshold: 95 });
      expect(result.score).toBe(100);
      expect(result.tone).toBe("green");
    });

    it("returns yellow when score is below custom green threshold but above yellow", () => {
      const result = assess({
        ocrConfidence: 0.95,
        warnings: [],
        parsed: fullParsed(),
        autoApprovalThreshold: 98
      });
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
      expect(result.tone).toBe("yellow");
    });

    it("returns red when score is below derived yellow threshold", () => {
      const result = assess({
        ocrConfidence: 0.95,
        warnings: ["w1", "w2", "w3"],
        parsed: fullParsed(),
        autoApprovalThreshold: 98
      });
      expect(result.tone).toBe("red");
    });

    it("falls back to 91 when autoApprovalThreshold is undefined", () => {
      const result = assess({ ocrConfidence: 1.0, warnings: [], autoApprovalThreshold: undefined });
      expect(result.tone).toBe("green");
    });

    it("uses low autoApprovalThreshold to make more scores green", () => {
      const result = assess({
        ocrConfidence: 0.95,
        warnings: ["w1", "w2", "w3"],
        parsed: fullParsed(),
        autoApprovalThreshold: 70
      });
      expect(result.tone).toBe("green");
    });
  });

  describe("NaN safety", () => {
    it.each([
      ["Infinity ocrConfidence", { ocrConfidence: Infinity }],
      ["-Infinity ocrConfidence", { ocrConfidence: -Infinity }],
      ["NaN complianceRiskPenalty", { complianceRiskPenalty: NaN }],
    ])("never returns NaN for %s", (_label, overrides) => {
      const result = assess(overrides);
      expect(Number.isFinite(result.score)).toBe(true);
    });

    it("returns finite score when all inputs are extreme", () => {
      const result = assessInvoiceConfidence({
        ocrConfidence: NaN,
        parsed: {} as ParsedInvoiceData,
        warnings: [],
        complianceRiskPenalty: Infinity,
        tenantConfig: {
          ocrWeight: NaN,
          completenessWeight: NaN,
          warningPenalty: NaN,
          warningPenaltyCap: NaN,
          requiredFields: [],
        },
      });
      expect(Number.isFinite(result.score)).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(100);
    });

    it("handles empty requiredFields without division by zero", () => {
      const result = assessInvoiceConfidence({
        ocrConfidence: 0.95,
        parsed: fullParsed(),
        warnings: [],
        tenantConfig: { requiredFields: [] },
      });
      expect(Number.isFinite(result.score)).toBe(true);
    });
  });
});

describe("getConfidenceTone", () => {
  it.each([
    [91, "green"],
    [95, "green"],
    [100, "green"],
    [80, "yellow"],
    [85, "yellow"],
    [90, "yellow"],
    [79, "red"],
    [50, "red"],
    [0, "red"],
  ])("returns %s for score %i", (score, tone) => {
    expect(getConfidenceTone(score)).toBe(tone);
  });

  describe("custom greenThreshold", () => {
    it.each([
      [85, 85, "green"],
      [90, 85, "green"],
      [80, 85, "yellow"],
      [74, 85, "yellow"],
      [73, 85, "red"],
      [50, 85, "red"],
    ])("score=%i with greenThreshold=%i returns %s", (score, threshold, tone) => {
      expect(getConfidenceTone(score, threshold)).toBe(tone);
    });

    it("derives yellow threshold as greenThreshold - 11", () => {
      expect(getConfidenceTone(89, 100)).toBe("yellow");
      expect(getConfidenceTone(88, 100)).toBe("red");
    });

    it("clamps yellow threshold at 0 for very low green threshold", () => {
      expect(getConfidenceTone(0, 5)).toBe("yellow");
      expect(getConfidenceTone(5, 5)).toBe("green");
      expect(getConfidenceTone(4, 5)).toBe("yellow");
    });

    it("handles greenThreshold of 0", () => {
      expect(getConfidenceTone(0, 0)).toBe("green");
    });

    it("handles greenThreshold of 11 with yellow at 0", () => {
      expect(getConfidenceTone(11, 11)).toBe("green");
      expect(getConfidenceTone(0, 11)).toBe("yellow");
    });
  });
});

describe("assessInvoiceConfidence with tenantConfig", () => {
  it("uses custom ocrWeight and completenessWeight", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed(),
      warnings: [],
      tenantConfig: { ocrWeight: 0.5, completenessWeight: 0.5 }
    });
    const expected = Math.round(95 * 0.5 + 100 * 0.5);
    expect(result.score).toBe(expected);
  });

  it("uses custom warningPenalty", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed(),
      warnings: ["w1", "w2"],
      tenantConfig: { warningPenalty: 10 }
    });
    const expected = Math.round(95 * 0.65 + 100 * 0.35 - 20);
    expect(result.score).toBe(expected);
  });

  it("uses custom warningPenaltyCap", () => {
    const warnings = Array.from({ length: 10 }, (_, i) => `w${i}`);
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed(),
      warnings,
      tenantConfig: { warningPenaltyCap: 10 }
    });
    const expected = Math.round(95 * 0.65 + 100 * 0.35 - 10);
    expect(result.score).toBe(expected);
  });

  it("uses custom requiredFields for completeness scoring", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed({ invoiceDate: undefined, currency: undefined }),
      warnings: [],
      tenantConfig: { requiredFields: ["invoiceNumber", "vendorName", "totalAmountMinor"] }
    });
    const completeness = Math.round((3 / 3) * 100);
    const expected = Math.round(95 * 0.65 + completeness * 0.35);
    expect(result.score).toBe(expected);
  });

  it("falls back to defaults when tenantConfig is undefined", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed(),
      warnings: [],
      tenantConfig: undefined
    });
    const expected = Math.round(95 * 0.65 + 100 * 0.35);
    expect(result.score).toBe(expected);
  });

  it("falls back to defaults when tenantConfig fields are all undefined", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed(),
      warnings: [],
      tenantConfig: {}
    });
    const expected = Math.round(95 * 0.65 + 100 * 0.35);
    expect(result.score).toBe(expected);
  });
});
