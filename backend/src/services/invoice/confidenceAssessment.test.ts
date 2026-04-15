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
    it("defaults to 0.6 when ocrConfidence is undefined", () => {
      const result = assess({ ocrConfidence: undefined });
      const expectedOcr = 0.6 * 100;
      const expectedCompleteness = 100;
      const expectedScore = Math.round(expectedOcr * 0.65 + expectedCompleteness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("defaults to 0.6 when ocrConfidence is NaN", () => {
      const result = assess({ ocrConfidence: NaN });
      const expectedOcr = 0.6 * 100;
      const expectedCompleteness = 100;
      const expectedScore = Math.round(expectedOcr * 0.65 + expectedCompleteness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("normalizes ocrConfidence > 1 by dividing by 100", () => {
      const result = assess({ ocrConfidence: 95 });
      const expectedOcr = 0.95 * 100;
      const expectedCompleteness = 100;
      const expectedScore = Math.round(expectedOcr * 0.65 + expectedCompleteness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("uses ocrConfidence as-is when in [0,1] range", () => {
      const result = assess({ ocrConfidence: 0.85 });
      const expectedOcr = 0.85 * 100;
      const expectedCompleteness = 100;
      const expectedScore = Math.round(expectedOcr * 0.65 + expectedCompleteness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("clamps ocrConfidence of exactly 0 to 0", () => {
      const result = assess({ ocrConfidence: 0 });
      const expectedCompleteness = 100;
      const expectedScore = Math.round(0 * 0.65 + expectedCompleteness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("treats ocrConfidence of exactly 1 as 1.0", () => {
      const result = assess({ ocrConfidence: 1 });
      const expectedScore = Math.round(100 * 0.65 + 100 * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("treats ocrConfidence of 0.5 as 0.5", () => {
      const result = assess({ ocrConfidence: 0.5 });
      const expectedScore = Math.round(50 * 0.65 + 100 * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("clamps ocrConfidence of 150 to 1.0 after dividing by 100", () => {
      const result = assess({ ocrConfidence: 150 });
      const expectedScore = Math.round(100 * 0.65 + 100 * 0.35);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("scoreCompleteness", () => {
    it("scores 100% when all 5 required fields are present", () => {
      const result = assess();
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
    });

    it("scores 0% when no required fields are present", () => {
      const result = assess({ parsed: {} });
      const expectedScore = Math.round(95 * 0.65 + 0 * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("scores proportionally for partial fields", () => {
      const parsed = { invoiceNumber: "INV-001", vendorName: "ACME" };
      const result = assess({ parsed });
      const completeness = Math.round((2 / 5) * 100);
      const expectedScore = Math.round(95 * 0.65 + completeness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("ignores fields with empty string values", () => {
      const parsed = fullParsed({ invoiceNumber: "", vendorName: "" });
      const result = assess({ parsed });
      const completeness = Math.round((3 / 5) * 100);
      const expectedScore = Math.round(95 * 0.65 + completeness * 0.35);
      expect(result.score).toBe(expectedScore);
    });

    it("ignores fields with null values", () => {
      const parsed = fullParsed({ invoiceNumber: undefined, currency: undefined });
      const result = assess({ parsed });
      const completeness = Math.round((3 / 5) * 100);
      const expectedScore = Math.round(95 * 0.65 + completeness * 0.35);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("warnings penalty", () => {
    it("applies no penalty for 0 warnings", () => {
      const result = assess({ warnings: [] });
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
    });

    it("applies 4-point penalty for 1 warning", () => {
      const result = assess({ warnings: ["something off"] });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - 4);
      expect(result.score).toBe(expectedScore);
    });

    it("caps penalty at 25 for more than 6 warnings", () => {
      const warnings = Array.from({ length: 10 }, (_, i) => `warning ${i}`);
      const result = assess({ warnings });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - 25);
      expect(result.score).toBe(expectedScore);
    });

    it("applies exactly 24-point penalty for 6 warnings", () => {
      const warnings = Array.from({ length: 6 }, (_, i) => `warning ${i}`);
      const result = assess({ warnings });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - 24);
      expect(result.score).toBe(expectedScore);
    });

    it("caps at 25 for 7 warnings (7*4=28 > 25)", () => {
      const warnings = Array.from({ length: 7 }, (_, i) => `warning ${i}`);
      const result = assess({ warnings });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - 25);
      expect(result.score).toBe(expectedScore);
    });
  });

  describe("complianceRiskPenalty", () => {
    it("applies no penalty when complianceRiskPenalty is 0", () => {
      const result = assess({ complianceRiskPenalty: 0 });
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
    });

    it("applies no penalty when complianceRiskPenalty is undefined", () => {
      const result = assess({ complianceRiskPenalty: undefined });
      expect(result.score).toBe(Math.round(95 * 0.65 + 100 * 0.35));
    });

    it("subtracts complianceRiskPenalty from score", () => {
      const result = assess({ complianceRiskPenalty: 15 });
      const expectedScore = Math.round(95 * 0.65 + 100 * 0.35 - 15);
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

  it("does not include riskFlags or riskMessages in result", () => {
    const result = assess();
    expect(result).not.toHaveProperty("riskFlags");
    expect(result).not.toHaveProperty("riskMessages");
  });
});

describe("getConfidenceTone", () => {
  it("returns green for score >= 91", () => {
    expect(getConfidenceTone(91)).toBe("green");
    expect(getConfidenceTone(95)).toBe("green");
    expect(getConfidenceTone(100)).toBe("green");
  });

  it("returns yellow for score >= 80 and < 91", () => {
    expect(getConfidenceTone(80)).toBe("yellow");
    expect(getConfidenceTone(85)).toBe("yellow");
    expect(getConfidenceTone(90)).toBe("yellow");
  });

  it("returns red for score < 80", () => {
    expect(getConfidenceTone(79)).toBe("red");
    expect(getConfidenceTone(50)).toBe("red");
    expect(getConfidenceTone(0)).toBe("red");
  });

  it("handles boundary values", () => {
    expect(getConfidenceTone(91)).toBe("green");
    expect(getConfidenceTone(90)).toBe("yellow");
    expect(getConfidenceTone(80)).toBe("yellow");
    expect(getConfidenceTone(79)).toBe("red");
  });

  describe("custom greenThreshold", () => {
    it("returns green when score meets custom threshold", () => {
      expect(getConfidenceTone(85, 85)).toBe("green");
      expect(getConfidenceTone(90, 85)).toBe("green");
    });

    it("returns yellow between custom yellow and green thresholds", () => {
      expect(getConfidenceTone(80, 85)).toBe("yellow");
      expect(getConfidenceTone(74, 85)).toBe("yellow");
    });

    it("returns red below derived yellow threshold", () => {
      expect(getConfidenceTone(73, 85)).toBe("red");
      expect(getConfidenceTone(50, 85)).toBe("red");
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
