import { UDYAM_FORMAT } from "@/constants/indianCompliance.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import type { ComplianceRiskSignal } from "@/types/invoice.js";
import type { MsmeClassification } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
const DEFAULT_MSME_PAYMENT_WARNING_DAYS = 30;
const DEFAULT_MSME_PAYMENT_OVERDUE_DAYS = 45;

interface MsmeTenantConfig {
  msmePaymentWarningDays?: number;
  msmePaymentOverdueDays?: number;
}

interface MsmeTrackingResult {
  msme: {
    udyamNumber: string | null;
    classification: MsmeClassification | null;
    paymentDeadline: Date | null;
  };
  riskSignals: ComplianceRiskSignal[];
}

export class MsmeTrackingService {
  async checkAndUpdate(
    tenantId: string,
    vendorFingerprint: string,
    udyamNumber: string | null | undefined,
    invoiceDate: Date | null | undefined,
    tenantConfig?: MsmeTenantConfig
  ): Promise<MsmeTrackingResult> {
    const riskSignals: ComplianceRiskSignal[] = [];
    let classification: MsmeClassification | null = null;
    let paymentDeadline: Date | null = null;
    const warningDays = tenantConfig?.msmePaymentWarningDays ?? DEFAULT_MSME_PAYMENT_WARNING_DAYS;
    const overdueDays = tenantConfig?.msmePaymentOverdueDays ?? DEFAULT_MSME_PAYMENT_OVERDUE_DAYS;

    if (udyamNumber && UDYAM_FORMAT.test(udyamNumber.toUpperCase())) {
      const existingVendor = await VendorMasterModel.findOne({ tenantId, vendorFingerprint }).lean();
      classification = (existingVendor?.msme?.classification as MsmeClassification | null) ?? null;
      await VendorMasterModel.updateOne(
        { tenantId, vendorFingerprint },
        { $set: { "msme.udyamNumber": udyamNumber.toUpperCase(), "msme.verifiedAt": new Date(), ...(classification ? { "msme.classification": classification } : {}) } }
      );
    } else {
      const vendor = await VendorMasterModel.findOne({ tenantId, vendorFingerprint }).lean();
      if (vendor?.msme?.udyamNumber) {
        classification = (vendor.msme.classification as MsmeClassification | null) ?? null;
      }
    }

    if (classification && invoiceDate) {
      const invDate = invoiceDate;
      if (!isNaN(invDate.getTime())) {
        paymentDeadline = new Date(invDate.getTime() + overdueDays * 86400000);
        const daysSinceInvoice = Math.floor((Date.now() - invDate.getTime()) / 86400000);

        if (daysSinceInvoice > overdueDays) {
          riskSignals.push(createRiskSignal(
            "MSME_PAYMENT_OVERDUE",
            "compliance",
            "critical",
            `MSME vendor — invoice is ${daysSinceInvoice} days old, exceeds ${overdueDays}-day payment deadline.`,
            10
          ));
        } else if (daysSinceInvoice > warningDays) {
          riskSignals.push(createRiskSignal(
            "MSME_PAYMENT_DUE_SOON",
            "compliance",
            "warning",
            `MSME vendor — invoice is ${daysSinceInvoice} days old, approaching ${overdueDays}-day payment deadline.`,
            4
          ));
        }
      }
    }

    return {
      msme: { udyamNumber: udyamNumber?.toUpperCase() ?? null, classification, paymentDeadline },
      riskSignals
    };
  }
}
