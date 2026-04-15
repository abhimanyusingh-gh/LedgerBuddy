import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator";
import type { ParsedInvoiceData } from "@/types/invoice";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals";

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
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED);
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
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED)).toBeUndefined();
    });
  });

  describe("TOTAL_AMOUNT_BELOW_MINIMUM", () => {
    it("flags when total is below 100 (10000 minor units)", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 5000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_BELOW_MINIMUM);
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
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_BELOW_MINIMUM)).toBeUndefined();
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
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR);
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
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR)).toBeUndefined();
    });
  });

  describe("MISSING_MANDATORY_FIELDS", () => {
    it("flags when vendor name is missing", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ vendorName: undefined }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.MISSING_MANDATORY_FIELDS);
      expect(signal).toBeDefined();
      expect(signal!.message).toContain("vendor name");
    });

    it("flags when total amount is missing", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: undefined }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.MISSING_MANDATORY_FIELDS);
      expect(signal).toBeDefined();
      expect(signal!.message).toContain("total amount");
    });

    it("does not flag when all mandatory fields present", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed(),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90
      });
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.MISSING_MANDATORY_FIELDS)).toBeUndefined();
    });
  });

  describe("sumPenalties", () => {
    it("sums penalties from multiple signals", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        createRiskSignal(RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED, "financial", "warning", "", 10),
        createRiskSignal(RISK_SIGNAL_CODE.TOTAL_AMOUNT_BELOW_MINIMUM, "financial", "warning", "", 8)
      ]);
      expect(penalty).toBe(18);
    });

    it("caps at 30", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        createRiskSignal(RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED, "financial", "critical", "", 20),
        createRiskSignal(RISK_SIGNAL_CODE.DUPLICATE_INVOICE_NUMBER, "financial", "critical", "", 20)
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

  describe("tenant config overrides", () => {
    it("uses maxInvoiceTotalMinor from tenant config instead of expectedMaxTotal", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 600000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        tenantConfig: { maxInvoiceTotalMinor: 500000 }
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED);
      expect(signal).toBeDefined();
    });

    it("skips amount-above check when maxInvoiceTotalMinor is undefined in config", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 5000000 }),
        expectedMaxTotal: 0,
        expectedMaxDueDays: 90,
        tenantConfig: {}
      });
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED)).toBeUndefined();
    });

    it("uses maxDueDays from tenant config", () => {
      const referenceDate = new Date("2026-01-01");
      const signals = evaluator.evaluate({
        parsed: baseParsed({ dueDate: new Date("2026-02-15") }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        referenceDate,
        tenantConfig: { maxDueDays: 30 }
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR);
      expect(signal).toBeDefined();
      expect(signal!.message).toContain("expected max is 30 days");
    });

    it("skips due-date check when maxDueDays is undefined in config", () => {
      const referenceDate = new Date("2026-01-01");
      const signals = evaluator.evaluate({
        parsed: baseParsed({ dueDate: new Date("2027-06-01") }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 0,
        referenceDate,
        tenantConfig: {}
      });
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR)).toBeUndefined();
    });

    it("uses minimumExpectedTotalMinor from tenant config", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 15000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        tenantConfig: { minimumExpectedTotalMinor: 20000 }
      });
      const signal = signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_BELOW_MINIMUM);
      expect(signal).toBeDefined();
    });

    it("does not flag below-minimum when amount exceeds tenant-configured minimum", () => {
      const signals = evaluator.evaluate({
        parsed: baseParsed({ totalAmountMinor: 5000 }),
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        tenantConfig: { minimumExpectedTotalMinor: 2000 }
      });
      expect(signals.find(s => s.code === RISK_SIGNAL_CODE.TOTAL_AMOUNT_BELOW_MINIMUM)).toBeUndefined();
    });

    it("uses custom riskSignalPenaltyCap in sumPenalties", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        createRiskSignal(RISK_SIGNAL_CODE.MSME_PAYMENT_OVERDUE, "financial", "critical", "", 20),
        createRiskSignal(RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE, "financial", "critical", "", 20)
      ], 50);
      expect(penalty).toBe(40);
    });

    it("falls back to default penalty cap when undefined", () => {
      const penalty = RiskSignalEvaluator.sumPenalties([
        createRiskSignal(RISK_SIGNAL_CODE.MSME_PAYMENT_OVERDUE, "financial", "critical", "", 20),
        createRiskSignal(RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE, "financial", "critical", "", 20)
      ], undefined);
      expect(penalty).toBe(30);
    });
  });
});
