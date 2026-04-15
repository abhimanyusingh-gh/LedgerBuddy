import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator";
import type { ParsedInvoiceData } from "@/types/invoice";

const evaluator = new RiskSignalEvaluator();

function baseParsed(overrides?: Partial<ParsedInvoiceData>): ParsedInvoiceData {
  return {
    invoiceNumber: "INV-001",
    vendorName: "Test Vendor",
    invoiceDate: new Date("2026-01-15"),
    totalAmountMinor: 5000000,
    currency: "INR",
    ...overrides
  };
}

describe("RiskSignalEvaluator", () => {
  describe("TOTAL_AMOUNT_ABOVE_EXPECTED", () => {
    it("flags when total exceeds expected max", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 20000000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === "TOTAL_AMOUNT_ABOVE_EXPECTED");
      expect(signal).toBeDefined();
      expect(signal!.category).toBe("financial");
      expect(signal!.severity).toBe("warning");
      expect(signal!.confidencePenalty).toBeGreaterThan(0);
    });

    it("does not flag when total is within range", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 5000000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      expect(signals.find(s => s.code === "TOTAL_AMOUNT_ABOVE_EXPECTED")).toBeUndefined();
    });
  });

  describe("TOTAL_AMOUNT_BELOW_MINIMUM", () => {
    it("flags when total is below 100 (10000 minor units)", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 5000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === "TOTAL_AMOUNT_BELOW_MINIMUM");
      expect(signal).toBeDefined();
      expect(signal!.severity).toBe("info");
      expect(signal!.confidencePenalty).toBe(0);
    });

    it("does not flag normal amounts", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed(),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      expect(signals.find(s => s.code === "TOTAL_AMOUNT_BELOW_MINIMUM")).toBeUndefined();
    });
  });

  describe("DUE_DATE_TOO_FAR", () => {
    it("flags when due date exceeds max days", () => {
      const referenceDate = new Date("2026-01-01");
      const signals = evaluator.evaluate({
        parsed: baseParsed({ dueDate: new Date("2027-06-01") }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        referenceDate
      });
      const signal = signals.find(s => s.code === "DUE_DATE_TOO_FAR");
      expect(signal).toBeDefined();
      expect(signal!.category).toBe("data-quality");
    });

    it("does not flag normal due dates", () => {
      const referenceDate = new Date("2026-01-01");
      const signals = evaluator.evaluate({
        parsed: baseParsed({ dueDate: new Date("2026-02-15") }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        referenceDate
      });
      expect(signals.find(s => s.code === "DUE_DATE_TOO_FAR")).toBeUndefined();
    });
  });

  describe("MISSING_MANDATORY_FIELDS", () => {
    it("flags when vendor name is missing", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ vendorName: undefined }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === "MISSING_MANDATORY_FIELDS");
      expect(signal).toBeDefined();
      expect(signal!.message).toContain("vendor name");
    });

    it("flags when total amount is missing", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: undefined }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === "MISSING_MANDATORY_FIELDS");
      expect(signal).toBeDefined();
      expect(signal!.message).toContain("total amount");
    });

    it("does not flag when all mandatory fields present", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed(),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      expect(signals.find(s => s.code === "MISSING_MANDATORY_FIELDS")).toBeUndefined();
    });
  });

  describe("sumPenalties", () => {
    it("sums penalties from multiple signals", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        { code: "A", category: "financial", severity: "warning", message: "", confidencePenalty: 10, status: "open", resolvedBy: null, resolvedAt: null },
        { code: "B", category: "financial", severity: "warning", message: "", confidencePenalty: 8, status: "open", resolvedBy: null, resolvedAt: null }
      ]);
      expect(penalty).toBe(18);
    });

    it("caps at 30", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        { code: "A", category: "financial", severity: "critical", message: "", confidencePenalty: 20, status: "open", resolvedBy: null, resolvedAt: null },
        { code: "B", category: "financial", severity: "critical", message: "", confidencePenalty: 20, status: "open", resolvedBy: null, resolvedAt: null }
      ]);
      expect(penalty).toBe(30);
    });

    it("returns 0 for empty array", () => {
      expect(RiskSignalEvaluator.sumPenalties([])).toBe(0);
    });
  });

  describe("clean invoice", () => {
    it("produces no signals for a complete, normal invoice", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed(),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      expect(signals).toHaveLength(0);
    });
  });
});
