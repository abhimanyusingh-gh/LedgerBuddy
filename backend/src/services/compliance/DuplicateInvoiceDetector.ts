import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import type { ComplianceRiskSignal } from "@/types/invoice.js";

export class DuplicateInvoiceDetector {
  async check(
    tenantId: string,
    vendorName: string | undefined,
    invoiceNumber: string | undefined,
    currentContentHash: string | undefined
  ): Promise<ComplianceRiskSignal[]> {
    if (!invoiceNumber || !vendorName) return [];

    const existing = await InvoiceModel.findOne({
      tenantId,
      "parsed.vendorName": vendorName,
      "parsed.invoiceNumber": invoiceNumber,
      status: { $ne: INVOICE_STATUS.PENDING }
    }).lean();

    if (!existing) return [];

    const existingHash = (existing as Record<string, unknown>).contentHash as string | undefined;
    if (currentContentHash && existingHash && currentContentHash === existingHash) return [];

    const existingAmount = existing.parsed?.totalAmountMinor;
    const existingDate = existing.parsed?.invoiceDate;

    return [{
      code: "DUPLICATE_INVOICE_NUMBER",
      category: "fraud",
      severity: "critical",
      message: `Vendor "${vendorName}" previously submitted invoice "${invoiceNumber}"${existingDate ? ` on ${existingDate}` : ""}${existingAmount ? ` for ${existingAmount}` : ""}. This submission has different content.`,
      confidencePenalty: 10,
      status: "open",
      resolvedBy: null,
      resolvedAt: null
    }];
  }
}
