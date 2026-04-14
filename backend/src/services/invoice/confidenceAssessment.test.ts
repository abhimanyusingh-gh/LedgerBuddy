import { assessInvoiceConfidence, getConfidenceTone } from "./confidenceAssessment.ts";
import type { ParsedInvoiceData } from "../types/invoice.ts";

function fullParsed(overrides?: Partial<ParsedInvoiceData>): ParsedInvoiceData {
  return {
    invoiceNumber: "INV-001",
    vendorName: "ACME Corp",
    invoiceDate: "2026-01-15",
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
    expectedMaxTotal: 10000,
    expectedMaxDueDays: 90,
    autoSelectMin: 80,
    referenceDate: new Date("2026-01-20T00:00:00.000Z"),
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

  describe("risk flags", () => {
    it("produces no risk flags when amount and date are within limits", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 50000, dueDate: "2026-02-01" }),
        expectedMaxTotal: 10000,
        expectedMaxDueDays: 90,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).toEqual([]);
      expect(result.riskMessages).toEqual([]);
    });

    it("flags TOTAL_AMOUNT_ABOVE_EXPECTED when amount exceeds max", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 2000000, currency: "USD" }),
        expectedMaxTotal: 10000
      });
      expect(result.riskFlags).toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
      expect(result.riskMessages.length).toBeGreaterThan(0);
      expect(result.riskMessages[0]).toContain("exceeds expected max");
    });

    it("flags DUE_DATE_TOO_FAR when due date exceeds max days", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: "2027-06-01" }),
        expectedMaxDueDays: 90,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).toContain("DUE_DATE_TOO_FAR");
      expect(result.riskMessages.length).toBeGreaterThan(0);
      expect(result.riskMessages[0]).toContain("days away");
    });

    it("flags both risks simultaneously", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 2000000, currency: "USD", dueDate: "2027-06-01" }),
        expectedMaxTotal: 10000,
        expectedMaxDueDays: 90,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
      expect(result.riskFlags).toContain("DUE_DATE_TOO_FAR");
      expect(result.riskMessages).toHaveLength(2);
    });

    it("does not flag amount when totalAmountMinor is undefined", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: undefined }),
        expectedMaxTotal: 10000
      });
      expect(result.riskFlags).not.toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
    });

    it("does not flag amount when totalAmountMinor is not an integer", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 1234.56 }),
        expectedMaxTotal: 10
      });
      expect(result.riskFlags).not.toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
    });

    it("does not flag amount when expectedMaxTotal is 0", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 999999 }),
        expectedMaxTotal: 0
      });
      expect(result.riskFlags).not.toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
    });

    it("does not flag due date when dueDate is undefined", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: undefined }),
        expectedMaxDueDays: 30
      });
      expect(result.riskFlags).not.toContain("DUE_DATE_TOO_FAR");
    });

    it("does not flag due date when dueDate is an invalid string", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: "not-a-date" }),
        expectedMaxDueDays: 30
      });
      expect(result.riskFlags).not.toContain("DUE_DATE_TOO_FAR");
    });

    it("does not flag due date when due date is within expected range", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: "2026-02-10" }),
        expectedMaxDueDays: 90,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).not.toContain("DUE_DATE_TOO_FAR");
    });

    it("does not flag due date when expectedMaxDueDays is 0", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: "2027-12-31" }),
        expectedMaxDueDays: 0,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).not.toContain("DUE_DATE_TOO_FAR");
    });

    it("includes currency prefix in risk message when currency is set", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 2000000, currency: "USD" }),
        expectedMaxTotal: 10000
      });
      expect(result.riskMessages[0]).toContain("USD ");
    });

    it("omits currency prefix in risk message when currency is undefined", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 2000000, currency: undefined }),
        expectedMaxTotal: 10000
      });
      expect(result.riskMessages[0]).not.toMatch(/^Total amount [A-Z]{3} /);
      expect(result.riskMessages[0]).toMatch(/^Total amount \d/);
    });

    it("penalty for amount is capped at 30", () => {
      const result = assess({
        parsed: fullParsed({ totalAmountMinor: 99999999, currency: "USD" }),
        expectedMaxTotal: 1
      });
      expect(result.riskFlags).toContain("TOTAL_AMOUNT_ABOVE_EXPECTED");
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it("penalty for due date is capped at 20", () => {
      const result = assess({
        parsed: fullParsed({ dueDate: "2036-01-01" }),
        expectedMaxDueDays: 30,
        referenceDate: new Date("2026-01-20T00:00:00.000Z")
      });
      expect(result.riskFlags).toContain("DUE_DATE_TOO_FAR");
      expect(result.score).toBeGreaterThanOrEqual(0);
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
  });

  describe("score clamping", () => {
    it("clamps score at 0 for very bad input", () => {
      const warnings = Array.from({ length: 20 }, (_, i) => `w${i}`);
      const result = assess({
        ocrConfidence: 0,
        parsed: {},
        warnings,
        expectedMaxTotal: 1,
        expectedMaxDueDays: 1,
        autoSelectMin: 80
      });
      expect(result.score).toBe(0);
    });

    it("clamps score at 100 for perfect input", () => {
      const result = assess({
        ocrConfidence: 1.0,
        parsed: fullParsed(),
        warnings: [],
        expectedMaxTotal: 10000,
        expectedMaxDueDays: 90,
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

  it("uses default referenceDate when not provided", () => {
    const result = assessInvoiceConfidence({
      ocrConfidence: 0.95,
      parsed: fullParsed({ dueDate: "2099-12-31" }),
      warnings: [],
      expectedMaxTotal: 10000,
      expectedMaxDueDays: 30,
      autoSelectMin: 80
    });
    expect(result.riskFlags).toContain("DUE_DATE_TOO_FAR");
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
});
