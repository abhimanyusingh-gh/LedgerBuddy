import type { ComplianceRiskSignal } from "@/types/invoice.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";

const UDYAM_FORMAT = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const MSME_PAYMENT_WARNING_DAYS = 30;
const MSME_PAYMENT_OVERDUE_DAYS = 45;

interface MsmeTrackingResult {
  msme: {
    udyamNumber: string | null;
    classification: "micro" | "small" | "medium" | null;
    paymentDeadline: Date | null;
  };
  riskSignals: ComplianceRiskSignal[];
}

export class MsmeTrackingService {
  async checkAndUpdate(
    tenantId: string,
    vendorFingerprint: string,
    udyamNumber: string | null | undefined,
    invoiceDate: string | null | undefined
  ): Promise<MsmeTrackingResult> {
    const riskSignals: ComplianceRiskSignal[] = [];
    let classification: "micro" | "small" | "medium" | null = null;
    let paymentDeadline: Date | null = null;

    if (udyamNumber && UDYAM_FORMAT.test(udyamNumber.toUpperCase())) {
      classification = this.classifyFromUdyam(udyamNumber);
      await VendorMasterModel.updateOne(
        { tenantId, vendorFingerprint },
        { $set: { "msme.udyamNumber": udyamNumber.toUpperCase(), "msme.classification": classification, "msme.verifiedAt": new Date() } }
      );
    } else {
      const vendor = await VendorMasterModel.findOne({ tenantId, vendorFingerprint }).lean();
      if (vendor?.msme?.udyamNumber) {
        classification = (vendor.msme.classification as "micro" | "small" | "medium" | null) ?? null;
      }
    }

    if (classification && invoiceDate) {
      const invDate = new Date(invoiceDate);
      if (!isNaN(invDate.getTime())) {
        paymentDeadline = new Date(invDate.getTime() + MSME_PAYMENT_OVERDUE_DAYS * 86400000);
        const daysSinceInvoice = Math.floor((Date.now() - invDate.getTime()) / 86400000);

        if (daysSinceInvoice > MSME_PAYMENT_OVERDUE_DAYS) {
          riskSignals.push({
            code: "MSME_PAYMENT_OVERDUE",
            category: "compliance",
            severity: "critical",
            message: `MSME vendor — invoice is ${daysSinceInvoice} days old, exceeds 45-day payment deadline.`,
            confidencePenalty: 10,
            status: "open",
            resolvedBy: null,
            resolvedAt: null
          });
        } else if (daysSinceInvoice > MSME_PAYMENT_WARNING_DAYS) {
          riskSignals.push({
            code: "MSME_PAYMENT_DUE_SOON",
            category: "compliance",
            severity: "warning",
            message: `MSME vendor — invoice is ${daysSinceInvoice} days old, approaching 45-day payment deadline.`,
            confidencePenalty: 4,
            status: "open",
            resolvedBy: null,
            resolvedAt: null
          });
        }
      }
    }

    return {
      msme: { udyamNumber: udyamNumber?.toUpperCase() ?? null, classification, paymentDeadline },
      riskSignals
    };
  }

  private classifyFromUdyam(_udyamNumber: string): "micro" | "small" | "medium" {
    return "small";
  }
}
