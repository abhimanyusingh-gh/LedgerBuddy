import type { RiskSignalCategory, RiskSignalSeverity, ComplianceRiskSignal } from "@/types/invoice.js";
import { RISK_SIGNAL_STATUS } from "@/types/invoice.js";
import type { RiskSignalCode } from "@/types/riskSignals.js";

export function createRiskSignal(
  code: RiskSignalCode,
  category: RiskSignalCategory,
  severity: RiskSignalSeverity,
  message: string,
  confidencePenalty: number
): ComplianceRiskSignal {
  return {
    code,
    category,
    severity,
    message,
    confidencePenalty,
    status: RISK_SIGNAL_STATUS.OPEN,
    resolvedBy: null,
    resolvedAt: null
  };
}
