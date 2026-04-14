import type { ComplianceRiskSignal } from "@/types/invoice.js";

const IRN_FORMAT = /^[a-f0-9]{64}$/i;
const E_INVOICE_THRESHOLD_MINOR = 500000000;

interface IrnValidationResult {
  irn: { value: string | null; valid: boolean | null };
  riskSignals: ComplianceRiskSignal[];
}

export class IrnValidationService {
  validate(
    irn: string | null | undefined,
    vendorGstin: string | null | undefined,
    totalAmountMinor: number | undefined
  ): IrnValidationResult {
    const riskSignals: ComplianceRiskSignal[] = [];

    if (!irn) {
      if (vendorGstin && totalAmountMinor && totalAmountMinor > E_INVOICE_THRESHOLD_MINOR) {
        riskSignals.push({
          code: "IRN_MISSING",
          category: "compliance",
          severity: "warning",
          message: "Invoice from a GSTIN-registered vendor above e-invoicing threshold but no IRN found.",
          confidencePenalty: 4,
          status: "open",
          resolvedBy: null,
          resolvedAt: null
        });
      }
      return { irn: { value: null, valid: null }, riskSignals };
    }

    const valid = IRN_FORMAT.test(irn.trim());
    if (!valid) {
      riskSignals.push({
        code: "IRN_FORMAT_INVALID",
        category: "compliance",
        severity: "warning",
        message: `IRN "${irn.substring(0, 16)}..." does not match expected 64-character hex format.`,
        confidencePenalty: 4,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });
    }

    return { irn: { value: irn.trim(), valid }, riskSignals };
  }
}
