import { createRiskSignal } from "@/services/compliance/riskSignalFactory";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals";

describe("createRiskSignal", () => {
  it("returns a ComplianceRiskSignal with all fields populated", () => {
    const signal = createRiskSignal(RISK_SIGNAL_CODE.PAN_FORMAT_INVALID, "compliance", "warning", "Something happened.", 5);

    expect(signal).toEqual({
      code: "PAN_FORMAT_INVALID",
      category: "compliance",
      severity: "warning",
      message: "Something happened.",
      confidencePenalty: 5,
      status: "open",
      resolvedBy: null,
      resolvedAt: null
    });
  });

  it("sets status to open for every signal", () => {
    const signal = createRiskSignal(RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED, "fraud", "critical", "", 10);
    expect(signal.status).toBe("open");
  });

  it("sets resolvedBy and resolvedAt to null", () => {
    const signal = createRiskSignal(RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED, "financial", "info", "msg", 0);
    expect(signal.resolvedBy).toBeNull();
    expect(signal.resolvedAt).toBeNull();
  });

  it("preserves zero confidencePenalty", () => {
    const signal = createRiskSignal(RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR, "data-quality", "info", "low", 0);
    expect(signal.confidencePenalty).toBe(0);
  });

  it("preserves high confidencePenalty", () => {
    const signal = createRiskSignal(RISK_SIGNAL_CODE.DUPLICATE_INVOICE_NUMBER, "fraud", "critical", "bad", 30);
    expect(signal.confidencePenalty).toBe(30);
  });
});
