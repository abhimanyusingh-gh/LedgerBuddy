import axios from "axios";
import type {
  AccountingExporter,
  ExportFileResult,
  ExportInvoicesOptions,
  ExportResultItem
} from "@/core/interfaces/AccountingExporter.js";
import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import { logger } from "@/utils/logger.js";
import { isRecord } from "@/utils/validation.js";
import { EXPORT_CONTENT_TYPE } from "@/types/mime.js";
import { toUUID } from "@/types/uuid.js";
import {
  buildTallyBatchImportXml,
  buildTallyPurchaseVoucherPayload,
  formatTallyDate,
  isSuccessfulImport,
  parseTallyImportResponse
} from "@/services/export/tallyExporter/xml.js";
import type {
  TallyExporterConfig,
  VoucherPayloadInput
} from "@/services/export/tallyExporter/xml.js";
import { resolveInvoiceTotalAmountMinor } from "@/services/export/tallyExporter/amountResolution.js";
import { buildTallyExportConfig } from "@/services/export/clientExportConfigResolver.js";
import {
  clearInFlightExportVersion,
  MissingVendorStateError,
  promoteExportVersion,
  resolveReExportDecision,
  stageInFlightExportVersion
} from "@/services/export/tallyReExportGuard.js";
import type { ReExportDecision } from "@/services/export/tallyReExportGuard.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { deriveVendorState } from "@/constants/gstinStateCodes.js";

export {
  buildTallyBatchImportXml,
  buildTallyPurchaseVoucherPayload,
  formatTallyDate,
  parseTallyImportResponse
} from "@/services/export/tallyExporter/xml.js";
export { resolveInvoiceTotalAmountMinor } from "@/services/export/tallyExporter/amountResolution.js";

async function postWithRetry(
  url: string,
  data: string,
  config: Parameters<typeof axios.post>[2],
  maxRetries = 1
): Promise<import("axios").AxiosResponse> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post(url, data, config);
    } catch (error) {
      const isNetworkError = isAxiosErrorLike(error) &&
        !("response" in error && (error as Record<string, unknown>).response);
      if (attempt < maxRetries && isNetworkError) {
        logger.warn("tally.export.retry", { attempt: attempt + 1, maxRetries, error: (error as Error).message });
        continue;
      }
      throw error;
    }
  }
  throw new Error("postWithRetry: exhausted retries");
}

export class TallyExporter implements AccountingExporter {
  readonly system = "tally";

  private readonly config: TallyExporterConfig;

  constructor(config: TallyExporterConfig) {
    this.config = config;
  }

  async exportInvoices(
    invoices: InvoiceDocument[],
    tenantId?: string,
    options?: ExportInvoicesOptions
  ): Promise<ExportResultItem[]> {
    const results: ExportResultItem[] = [];
    logger.info("tally.export.batch.start", { totalInvoices: invoices.length });

    const effectiveConfig = tenantId
      ? await this.resolveEffectiveConfig(tenantId)
      : this.config;

    const loggedClientOrgIds = new Set<string>();
    for (const invoice of invoices) {
      if (!invoice.clientOrgId) continue;
      const key = String(invoice.clientOrgId);
      if (loggedClientOrgIds.has(key)) continue;
      loggedClientOrgIds.add(key);
      const company = await ClientOrganizationModel.findById(key).lean();
      logger.info("tally.export.detected_version", {
        clientOrgId: key,
        detectedVersion: company?.detectedVersion ?? null
      });
    }

    for (let ordinal = 0; ordinal < invoices.length; ordinal++) {
      const invoice = invoices[ordinal];
      const invoiceId = toUUID(String(invoice._id));

      try {
        const validationError = validateInvoiceForExport(invoice, invoiceId);
        if (validationError) {
          if (validationError.logKey) {
            logger.warn(validationError.logKey, {
              invoiceId,
              invoiceNumber: invoice.parsed?.invoiceNumber ?? null
            });
          }
          results.push({ invoiceId, success: false, error: validationError.message, lineErrorOrdinal: ordinal });
          continue;
        }

        const decision = invoice.clientOrgId
          ? await resolveReExportDecision({
              clientOrgId: String(invoice.clientOrgId),
              invoiceId,
              currentExportVersion: invoice.exportVersion ?? 0,
              forceAlter: options?.forceAlter
            })
          : undefined;

        if (decision) {
          await stageInFlightExportVersion({
            invoiceId: String(invoice._id),
            expectedPriorVersion: decision.priorExportVersion
          });
        }

        const voucherPayload = mapInvoiceToVoucher(invoice, effectiveConfig, invoiceId, decision);

        let summary;
        try {
          const response = await postWithRetry(effectiveConfig.endpoint, voucherPayload, {
            headers: {
              "Content-Type": "text/xml; charset=utf-8"
            },
            timeout: 30_000,
            responseType: "text"
          });
          summary = parseTallyImportResponse(String(response.data ?? ""));
        } catch (postError) {
          if (decision) {
            await clearInFlightExportVersion({
              invoiceId: String(invoice._id),
              stagedVersion: decision.nextExportVersion
            }).catch((clearErr) => {
              logger.error("tally.export.inflight.clear_failed", {
                invoiceId,
                stagedVersion: decision.nextExportVersion,
                error: (clearErr as Error).message
              });
            });
          }
          throw postError;
        }

        if (!isSuccessfulImport(summary)) {
          if (decision) {
            await clearInFlightExportVersion({
              invoiceId: String(invoice._id),
              stagedVersion: decision.nextExportVersion
            }).catch((clearErr) => {
              logger.error("tally.export.inflight.clear_failed", {
                invoiceId,
                stagedVersion: decision.nextExportVersion,
                error: (clearErr as Error).message
              });
            });
          }
          const detail = summary.lineErrors[0] ?? `Import failed with ERRORS=${summary.errors}`;
          logger.warn("tally.export.invoice.failed", { invoiceId, error: detail });
          results.push({
            invoiceId,
            success: false,
            error: detail,
            lineErrorOrdinal: ordinal,
            exportVersion: decision?.nextExportVersion,
            guid: decision?.guid
          });
          continue;
        }

        if (decision) {
          await promoteExportVersion({
            invoiceId: String(invoice._id),
            stagedVersion: decision.nextExportVersion
          });
        }

        logger.info("tally.export.invoice.success", { invoiceId, reference: summary.lastVchId ?? null });
        results.push({
          invoiceId,
          success: true,
          externalReference: summary.lastVchId ?? `CREATED-${summary.created}`,
          exportVersion: decision?.nextExportVersion,
          guid: decision?.guid
        });
      } catch (error) {
        logger.error("tally.export.invoice.error", { invoiceId, error: extractTallyError(error) });
        results.push({
          invoiceId,
          success: false,
          error: extractTallyError(error),
          lineErrorOrdinal: ordinal
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

  generateImportFile(invoices: InvoiceDocument[], tenantId?: string): ExportFileResult | Promise<ExportFileResult> {
    if (tenantId) {
      return this.generateImportFileWithTenantConfig(invoices, tenantId);
    }
    return this.buildImportFile(this.config, invoices);
  }

  private async generateImportFileWithTenantConfig(invoices: InvoiceDocument[], tenantId: string): Promise<ExportFileResult> {
    const effectiveConfig = await this.resolveEffectiveConfig(tenantId);
    return this.buildImportFile(effectiveConfig, invoices);
  }

  private async resolveEffectiveConfig(tenantId: string): Promise<TallyExporterConfig> {
    const resolved = await buildTallyExportConfig(tenantId, undefined, {
      companyName: this.config.companyName,
      purchaseLedgerName: this.config.purchaseLedgerName,
      gstLedgers: this.config.gstLedgers,
      tdsLedgerPrefix: this.config.tdsLedgerPrefix,
      tcsLedgerName: this.config.tcsLedgerName
    });

    return {
      endpoint: this.config.endpoint,
      companyName: resolved.companyName,
      purchaseLedgerName: resolved.purchaseLedgerName,
      gstLedgers: resolved.gstLedgers,
      tdsLedgerPrefix: resolved.tdsLedgerPrefix,
      tcsLedgerName: resolved.tcsLedgerName
    };
  }

  private buildImportFile(config: TallyExporterConfig, invoices: InvoiceDocument[]): ExportFileResult {
    const inputs: VoucherPayloadInput[] = [];
    const skippedItems: ExportResultItem[] = [];

    for (const invoice of invoices) {
      const invoiceId = toUUID(String(invoice._id));
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

      try {
        inputs.push(buildVoucherInput(config, invoice, invoiceId, resolvedAmount));
      } catch (error) {
        if (error instanceof MissingVendorStateError) {
          skippedItems.push({ invoiceId, success: false, error: error.message });
          continue;
        }
        throw error;
      }
    }

    if (inputs.length === 0) {
      return {
        content: Buffer.alloc(0),
        contentType: EXPORT_CONTENT_TYPE.TEXT_XML,
        filename: `tally-import-${Date.now()}.xml`,
        includedCount: 0,
        skippedItems
      };
    }

    const xml = buildTallyBatchImportXml(config.companyName, inputs);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return {
      content: Buffer.from(xml, "utf-8"),
      contentType: EXPORT_CONTENT_TYPE.TEXT_XML,
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
  const vendorGstin = invoice.parsed?.vendorGstin ?? invoice.parsed?.gst?.gstin ?? null;
  const partyStateName = deriveVendorState(vendorGstin, invoice.parsed?.vendorAddress ?? null);
  if (!partyStateName) {
    throw new MissingVendorStateError(invoiceId, invoice.parsed?.vendorName ?? null);
  }

  const input: VoucherPayloadInput = {
    companyName: config.companyName,
    purchaseLedgerName: config.purchaseLedgerName,
    voucherNumber: invoice.parsed?.invoiceNumber ?? invoiceId,
    partyLedgerName: invoice.parsed?.vendorName ?? "Unknown Vendor",
    amountMinor: resolvedAmountMinor,
    currency: invoice.parsed?.currency ?? undefined,
    date: (invoice.parsed?.invoiceDate instanceof Date && !isNaN(invoice.parsed.invoiceDate.getTime())) ? invoice.parsed.invoiceDate : (invoice.receivedAt ?? new Date()),
    narration: buildNarration(invoice),
    partyStateName
  };

  const invoiceObj = invoice as unknown as Record<string, unknown>;
  const compliance = isRecord(invoiceObj.compliance)
    ? (invoiceObj.compliance as { tds?: { section?: string; amountMinor?: number; netPayableMinor?: number }; tcs?: { amountMinor?: number }; glCode?: { code?: string; name?: string } })
    : undefined;

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

interface ExportValidationRule {
  validate(invoice: InvoiceDocument, resolvedAmount: number | null): string | null;
}

class AmountValidationRule implements ExportValidationRule {
  validate(_invoice: InvoiceDocument, resolvedAmount: number | null): string | null {
    if (resolvedAmount === null) return "Invalid invoice total amount for Tally export.";
    return null;
  }
}

class VendorNameValidationRule implements ExportValidationRule {
  validate(invoice: InvoiceDocument): string | null {
    const vendorName = invoice.parsed?.vendorName?.trim();
    if (!vendorName || vendorName === "Unknown Vendor") return "Vendor name is missing or invalid for Tally export.";
    return null;
  }
}

class InvoiceNumberValidationRule implements ExportValidationRule {
  validate(invoice: InvoiceDocument): string | null {
    const invoiceNumber = invoice.parsed?.invoiceNumber?.trim();
    if (!invoiceNumber || /^[0-9a-f]{24}$/i.test(invoiceNumber)) return "Invoice number is missing or invalid for Tally export.";
    return null;
  }
}

const EXPORT_VALIDATION_RULES: ExportValidationRule[] = [
  new AmountValidationRule(),
  new VendorNameValidationRule(),
  new InvoiceNumberValidationRule()
];

interface ValidationError {
  message: string;
  logKey?: string;
}

function validateInvoiceForExport(invoice: InvoiceDocument, invoiceId: string): ValidationError | null {
  const resolvedAmount = resolveInvoiceTotalAmountMinor(
    invoice.parsed?.totalAmountMinor,
    invoice.parsed?.currency,
    invoice.ocrText
  );

  for (const rule of EXPORT_VALIDATION_RULES) {
    const error = rule.validate(invoice, resolvedAmount);
    if (error) {
      const logKey = rule instanceof AmountValidationRule ? "tally.export.invoice.invalid_amount" : undefined;
      return { message: error, logKey };
    }
  }

  return null;
}

function mapInvoiceToVoucher(
  invoice: InvoiceDocument,
  config: TallyExporterConfig,
  invoiceId: string,
  decision?: ReExportDecision
): string {
  const resolvedTotalAmountMinor = resolveInvoiceTotalAmountMinor(
    invoice.parsed?.totalAmountMinor,
    invoice.parsed?.currency,
    invoice.ocrText
  )!;

  const input = buildVoucherInput(config, invoice, invoiceId, resolvedTotalAmountMinor);
  return buildTallyPurchaseVoucherPayload(decision ? applyReExportDecision(input, decision) : input);
}

function applyReExportDecision(
  input: VoucherPayloadInput,
  decision: ReExportDecision
): VoucherPayloadInput {
  const placeOfSupplyStateName = (
    decision.buyerStateName &&
    input.partyStateName &&
    decision.buyerStateName.trim().toLowerCase() !== input.partyStateName.trim().toLowerCase()
  ) ? decision.buyerStateName : undefined;

  return {
    ...input,
    guid: decision.guid,
    action: decision.action,
    placeOfSupplyStateName: placeOfSupplyStateName ?? input.placeOfSupplyStateName
  };
}
