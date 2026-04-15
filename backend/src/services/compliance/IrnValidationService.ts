import { IRN_FORMAT, E_INVOICE_THRESHOLD_MINOR } from "@/constants/indianCompliance.js";
import type { ComplianceRiskSignal } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";

interface IrnValidationResult {
  irn: { value: string | null; valid: boolean | null };
  riskSignals: ComplianceRiskSignal[];
}

interface IrnTenantConfig {
  eInvoiceThresholdMinor?: number;
}

export class IrnValidationService {
  validate(
    irn: string | null | undefined,
    vendorGstin: string | null | undefined,
    totalAmountMinor: number | undefined,
    tenantConfig?: IrnTenantConfig
  ): IrnValidationResult {
    const riskSignals: ComplianceRiskSignal[] = [];
    const threshold = tenantConfig?.eInvoiceThresholdMinor ?? E_INVOICE_THRESHOLD_MINOR;

    if (!irn) {
      if (vendorGstin && totalAmountMinor && totalAmountMinor > threshold) {
        riskSignals.push(createRiskSignal(
          "IRN_MISSING",
          "compliance",
          "warning",
          "Invoice from a GSTIN-registered vendor above e-invoicing threshold but no IRN found.",
          4
        ));
      }
      return { irn: { value: null, valid: null }, riskSignals };
    }

    const valid = IRN_FORMAT.test(irn.trim());
    if (!valid) {
      riskSignals.push(createRiskSignal(
        "IRN_FORMAT_INVALID",
        "compliance",
        "warning",
        `IRN "${irn.substring(0, 16)}..." does not match expected 64-character hex format.`,
        4
      ));
    }

    return { irn: { value: irn.trim(), valid }, riskSignals };
  }
}
