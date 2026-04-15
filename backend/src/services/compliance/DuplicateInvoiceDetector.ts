import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import type { ComplianceRiskSignal } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";

export class DuplicateInvoiceDetector {
  async check(
    tenantId: string,
    vendorName: string | undefined,
    invoiceNumber: string | undefined,
    currentContentHash: string | undefined,
    currentInvoiceId?: string
  ): Promise<ComplianceRiskSignal[]> {
    if (!invoiceNumber || !vendorName) return [];

    const query: Record<string, unknown> = {
      tenantId,
      "parsed.vendorName": vendorName,
      "parsed.invoiceNumber": invoiceNumber,
      status: { $ne: INVOICE_STATUS.PENDING }
    };
    if (currentInvoiceId) {
      query._id = { $ne: currentInvoiceId };
    }

    const existing = await InvoiceModel.findOne(query).lean();

    if (!existing) return [];

    const existingHash = (existing as Record<string, unknown>).contentHash as string | undefined;
    if (currentContentHash && existingHash && currentContentHash === existingHash) return [];

    const existingAmount = existing.parsed?.totalAmountMinor;
    const existingDate = existing.parsed?.invoiceDate;

    return [createRiskSignal(
      "DUPLICATE_INVOICE_NUMBER",
      "fraud",
      "critical",
      `Vendor "${vendorName}" previously submitted invoice "${invoiceNumber}"${existingDate ? ` on ${existingDate instanceof Date ? existingDate.toISOString().slice(0, 10) : String(existingDate)}` : ""}${existingAmount ? ` for ${existingAmount}` : ""}. This submission has different content.`,
      10
    )];
  }
}
