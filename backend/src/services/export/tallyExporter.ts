import axios from "axios";
import type { AccountingExporter, ExportFileResult, ExportResultItem } from "@/core/interfaces/AccountingExporter.js";
import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import { logger } from "@/utils/logger.js";
import {
  buildTallyBatchImportXml,
  buildTallyPurchaseVoucherPayload,
  formatTallyDate,
  isSuccessfulImport,
  parseTallyImportResponse
} from "./tallyExporter/xml.js";
import type {
  TallyExporterConfig,
  VoucherPayloadInput
} from "./tallyExporter/xml.js";
import { resolveInvoiceTotalAmountMinor } from "./tallyExporter/amountResolution.js";

export {
  buildTallyBatchImportXml,
  buildTallyPurchaseVoucherPayload,
  formatTallyDate,
  parseTallyImportResponse
} from "./tallyExporter/xml.js";
export { resolveInvoiceTotalAmountMinor } from "./tallyExporter/amountResolution.js";

export class TallyExporter implements AccountingExporter {
  readonly system = "tally";

  private readonly config: TallyExporterConfig;

  constructor(config: TallyExporterConfig) {
    this.config = config;
  }

  async exportInvoices(invoices: InvoiceDocument[]): Promise<ExportResultItem[]> {
    const results: ExportResultItem[] = [];
    logger.info("tally.export.batch.start", { totalInvoices: invoices.length });

    for (const invoice of invoices) {
      const invoiceId = String(invoice._id);

      try {
        const resolvedTotalAmountMinor = resolveInvoiceTotalAmountMinor(
          invoice.parsed?.totalAmountMinor,
          invoice.parsed?.currency,
          invoice.ocrText
        );
        if (resolvedTotalAmountMinor === null) {
          logger.warn("tally.export.invoice.invalid_amount", {
            invoiceId,
            invoiceNumber: invoice.parsed?.invoiceNumber ?? null
          });
          results.push({
            invoiceId,
            success: false,
            error: "Invalid invoice total amount for Tally export."
          });
          continue;
        }

        const vendorName = invoice.parsed?.vendorName?.trim();
        if (!vendorName || vendorName === "Unknown Vendor") {
          results.push({ invoiceId, success: false, error: "Vendor name is missing or invalid for Tally export." });
          continue;
        }

        const invoiceNumber = invoice.parsed?.invoiceNumber?.trim();
        if (!invoiceNumber || /^[0-9a-f]{24}$/i.test(invoiceNumber)) {
          results.push({ invoiceId, success: false, error: "Invoice number is missing or invalid for Tally export." });
          continue;
        }

        if (invoice.parsed?.totalAmountMinor !== resolvedTotalAmountMinor) {
          invoice.set("parsed", {
            ...(invoice.parsed ?? {}),
            totalAmountMinor: resolvedTotalAmountMinor
          });
          const existingIssues = (invoice.get("processingIssues") as string[] | undefined) ?? [];
          invoice.set(
            "processingIssues",
            [...existingIssues, "Total amount was recovered from OCR text during export mapping."]
          );
        }

        const voucherPayload = buildTallyPurchaseVoucherPayload(buildVoucherInput(this.config, invoice, invoiceId, resolvedTotalAmountMinor));

        const response = await axios.post(this.config.endpoint, voucherPayload, {
          headers: {
            "Content-Type": "text/xml; charset=utf-8"
          },
          timeout: 20_000,
          responseType: "text"
        });

        const summary = parseTallyImportResponse(String(response.data ?? ""));
        if (!isSuccessfulImport(summary)) {
          const detail = summary.lineErrors[0] ?? `Import failed with ERRORS=${summary.errors}`;
          logger.warn("tally.export.invoice.failed", { invoiceId, error: detail });
          results.push({
            invoiceId,
            success: false,
            error: detail
          });
          continue;
        }

        logger.info("tally.export.invoice.success", { invoiceId, reference: summary.lastVchId ?? null });
        results.push({
          invoiceId,
          success: true,
          externalReference: summary.lastVchId ?? `CREATED-${summary.created}`
        });
      } catch (error) {
        logger.error("tally.export.invoice.error", { invoiceId, error: extractTallyError(error) });
        results.push({
          invoiceId,
          success: false,
          error: extractTallyError(error)
        });
      }
    }

    logger.info("tally.export.batch.complete", {
      totalInvoices: invoices.length,
      successCount: results.filter((item) => item.success).length,
      failureCount: results.filter((item) => !item.success).length
    });
    return results;
  }

  generateImportFile(invoices: InvoiceDocument[]): ExportFileResult {
    const inputs: VoucherPayloadInput[] = [];
    const skippedItems: ExportResultItem[] = [];

    for (const invoice of invoices) {
      const invoiceId = String(invoice._id);
      const resolvedAmount = resolveInvoiceTotalAmountMinor(
        invoice.parsed?.totalAmountMinor,
        invoice.parsed?.currency,
        invoice.ocrText
      );
      if (resolvedAmount === null) {
        skippedItems.push({
          invoiceId,
          success: false,
          error: "Invalid invoice total amount for Tally export."
        });
        continue;
      }

      inputs.push(buildVoucherInput(this.config, invoice, invoiceId, resolvedAmount));
    }

    if (inputs.length === 0) {
      return {
        content: Buffer.alloc(0),
        contentType: "text/xml",
        filename: `tally-import-${Date.now()}.xml`,
        includedCount: 0,
        skippedItems
      };
  }

    const xml = buildTallyBatchImportXml(this.config.companyName, inputs);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return {
      content: Buffer.from(xml, "utf-8"),
      contentType: "text/xml",
      filename: `tally-import-${timestamp}.xml`,
      includedCount: inputs.length,
      skippedItems
    };
  }
}

function extractTallyError(error: unknown): string {
  if (!isAxiosErrorLike(error)) {
    return "Unknown export failure";
  }

  const responseData = typeof error.response?.data === "string" ? error.response.data : "";
  if (responseData) {
    const parsed = parseTallyImportResponse(responseData);
    if (parsed.lineErrors.length > 0) {
      return parsed.lineErrors[0];
    }

    if (parsed.errors > 0) {
      return `Tally import failed with ERRORS=${parsed.errors}`;
    }
  }

  return error.message;
}

function isAxiosErrorLike(error: unknown): error is { message: string; response?: { data?: unknown } } {
  return typeof error === "object" && error !== null && "message" in error;
}

function buildVoucherInput(
  config: TallyExporterConfig,
  invoice: InvoiceDocument,
  invoiceId: string,
  resolvedAmountMinor: number
): VoucherPayloadInput {
  const input: VoucherPayloadInput = {
    companyName: config.companyName,
    purchaseLedgerName: config.purchaseLedgerName,
    voucherNumber: invoice.parsed?.invoiceNumber ?? invoiceId,
    partyLedgerName: invoice.parsed?.vendorName ?? "Unknown Vendor",
    amountMinor: resolvedAmountMinor,
    currency: invoice.parsed?.currency ?? undefined,
    date: formatTallyDate(invoice.parsed?.invoiceDate, invoice.receivedAt),
    narration: buildNarration(invoice)
  };

  const compliance = (invoice as unknown as Record<string, unknown>).compliance as
    { tds?: { section?: string; amountMinor?: number; netPayableMinor?: number }; tcs?: { amountMinor?: number }; glCode?: { code?: string; name?: string } } | undefined;

  if (compliance?.glCode?.name) {
    input.purchaseLedgerName = compliance.glCode.name;
  }

  if (compliance?.tds?.section && compliance.tds.amountMinor && compliance.tds.amountMinor > 0) {
    const tdsLedgerPrefix = config.tdsLedgerPrefix ?? "TDS Payable";
    input.tds = {
      section: compliance.tds.section,
      amountMinor: compliance.tds.amountMinor,
      ledgerName: `${tdsLedgerPrefix} - ${compliance.tds.section}`
    };
    if (compliance.tds.netPayableMinor !== undefined && compliance.tds.netPayableMinor !== null) {
      input.amountMinor = compliance.tds.netPayableMinor;
    }
  }

  if (compliance?.tcs?.amountMinor && compliance.tcs.amountMinor > 0) {
    const tcsLedgerName = config.tcsLedgerName ?? "TCS Receivable";
    input.tcs = {
      amountMinor: compliance.tcs.amountMinor,
      ledgerName: tcsLedgerName
    };
  }

  const gst = invoice.parsed?.gst;
  if (gst && config.gstLedgers) {
    input.gstin = gst.gstin ?? undefined;
    const taxSum = (gst.cgstMinor ?? 0) + (gst.sgstMinor ?? 0) + (gst.igstMinor ?? 0) + (gst.cessMinor ?? 0);
    let derivedSubtotal = gst.subtotalMinor;
    if (derivedSubtotal === undefined || derivedSubtotal === null) {
      derivedSubtotal = taxSum > 0 ? resolvedAmountMinor - taxSum : resolvedAmountMinor;
    } else if (taxSum > 0) {
      const expectedTotal = derivedSubtotal + taxSum;
      if (Math.abs(expectedTotal - resolvedAmountMinor) > 1) {
        derivedSubtotal = resolvedAmountMinor - taxSum;
      }
    }
    input.gst = {
      subtotalMinor: derivedSubtotal > 0 ? derivedSubtotal : resolvedAmountMinor,
      cgstMinor: gst.cgstMinor ?? undefined,
      sgstMinor: gst.sgstMinor ?? undefined,
      igstMinor: gst.igstMinor ?? undefined,
      cessMinor: gst.cessMinor ?? undefined
    };
    input.gstLedgers = config.gstLedgers;
  }

  return input;
}

function buildNarration(invoice: InvoiceDocument): string {
  const parts = [
    `Source=${invoice.sourceType}:${invoice.sourceKey}`,
    `Attachment=${invoice.attachmentName}`,
    `InternalId=${String(invoice._id)}`
  ];

  return parts.join(" | ");
}
