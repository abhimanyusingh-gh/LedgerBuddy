import axios from "axios";
import type { AccountingExporter, ExportFileResult, ExportResultItem } from "../core/interfaces/AccountingExporter.js";
import type { InvoiceDocument } from "../models/Invoice.js";
import { extractTotalAmount } from "../parser/invoiceParser.js";
import { logger } from "../utils/logger.js";
import {
  isPositiveMinorUnits,
  minorUnitsToMajorString,
  normalizeMinorUnits,
  toMinorUnits
} from "../utils/currency.js";

interface TallyExporterConfig {
  endpoint: string;
  companyName: string;
  purchaseLedgerName: string;
}

interface TallyImportSummary {
  status: number | null;
  created: number;
  altered: number;
  errors: number;
  lastVchId: string | null;
  lineErrors: string[];
}

interface VoucherPayloadInput {
  companyName: string;
  purchaseLedgerName: string;
  voucherNumber: string;
  partyLedgerName: string;
  amountMinor: number;
  currency?: string;
  date: string;
  narration?: string;
}

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

        if (invoice.parsed?.totalAmountMinor !== resolvedTotalAmountMinor) {
          invoice.set("parsed", {
            ...(invoice.parsed ?? {}),
            totalAmountMinor: resolvedTotalAmountMinor
          });
          const existingIssues = (invoice.get("processingIssues") as string[] | undefined) ?? [];
          invoice.set(
            "processingIssues",
            [...existingIssues, "Total amount was recovered from OCR text during export mapping."].slice(-50)
          );
        }

        const voucherPayload = buildTallyPurchaseVoucherPayload({
          companyName: this.config.companyName,
          purchaseLedgerName: this.config.purchaseLedgerName,
          voucherNumber: invoice.parsed?.invoiceNumber ?? invoiceId,
          partyLedgerName: invoice.parsed?.vendorName ?? "Unknown Vendor",
          amountMinor: resolvedTotalAmountMinor,
          currency: invoice.parsed?.currency ?? undefined,
          date: formatTallyDate(invoice.parsed?.invoiceDate, invoice.receivedAt),
          narration: buildNarration(invoice)
        });

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

      inputs.push({
        companyName: this.config.companyName,
        purchaseLedgerName: this.config.purchaseLedgerName,
        voucherNumber: invoice.parsed?.invoiceNumber ?? invoiceId,
        partyLedgerName: invoice.parsed?.vendorName ?? "Unknown Vendor",
        amountMinor: resolvedAmount,
        currency: invoice.parsed?.currency ?? undefined,
        date: formatTallyDate(invoice.parsed?.invoiceDate, invoice.receivedAt),
        narration: buildNarration(invoice)
      });
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

export function resolveInvoiceTotalAmountMinor(
  parsedTotalAmountMinor?: number | null,
  currency?: string | null,
  ocrText?: string | null
): number | null {
  const normalizedParsedMinor = normalizeMinorUnits(parsedTotalAmountMinor);
  if (isPositiveMinorUnits(normalizedParsedMinor)) {
    return normalizedParsedMinor;
  }

  if (!ocrText || ocrText.trim().length === 0) {
    return null;
  }

  const ocrDerived = extractTotalAmount(ocrText);
  if (!isPositiveAmount(ocrDerived)) {
    return null;
  }

  return toMinorUnits(ocrDerived, currency);
}

export function buildTallyPurchaseVoucherPayload(input: VoucherPayloadInput): string {
  const companyName = xmlEscape(input.companyName);
  return wrapVouchersInEnvelope(companyName, [buildVoucherElement(input)]);
}

export function buildTallyBatchImportXml(companyName: string, inputs: VoucherPayloadInput[]): string {
  const escapedCompany = xmlEscape(companyName);
  const elements = inputs.map(buildVoucherElement);
  return wrapVouchersInEnvelope(escapedCompany, elements);
}

function buildVoucherElement(input: VoucherPayloadInput): string {
  const voucherNumber = xmlEscape(input.voucherNumber);
  const partyLedgerName = xmlEscape(input.partyLedgerName);
  const purchaseLedgerName = xmlEscape(input.purchaseLedgerName);
  const narration = xmlEscape(input.narration ?? "Invoice import from Invoice Processor");
  const amount = formatAmount(Math.abs(input.amountMinor), input.currency);

  return [
    "        <VOUCHER VCHTYPE=\"Purchase\" ACTION=\"Create\" OBJVIEW=\"Accounting Voucher View\">",
    `          <DATE>${input.date}</DATE>`,
    "          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
    `          <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>`,
    "          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
    "          <ISINVOICE>No</ISINVOICE>",
    `          <PARTYLEDGERNAME>${partyLedgerName}</PARTYLEDGERNAME>`,
    `          <NARRATION>${narration}</NARRATION>`,
    "          <LEDGERENTRIES.LIST>",
    `            <LEDGERNAME>${partyLedgerName}</LEDGERNAME>`,
    "            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
    "            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>",
    "            <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>",
    `            <AMOUNT>-${amount}</AMOUNT>`,
    "          </LEDGERENTRIES.LIST>",
    "          <LEDGERENTRIES.LIST>",
    `            <LEDGERNAME>${purchaseLedgerName}</LEDGERNAME>`,
    "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
    `            <AMOUNT>${amount}</AMOUNT>`,
    "          </LEDGERENTRIES.LIST>",
    "        </VOUCHER>"
  ].join("\n");
}

function wrapVouchersInEnvelope(escapedCompanyName: string, voucherElements: string[]): string {
  return [
    "<ENVELOPE>",
    "  <HEADER>",
    "    <VERSION>1</VERSION>",
    "    <TALLYREQUEST>Import</TALLYREQUEST>",
    "    <TYPE>Data</TYPE>",
    "    <ID>Vouchers</ID>",
    "  </HEADER>",
    "  <BODY>",
    "    <DESC>",
    "      <STATICVARIABLES>",
    `        <SVCURRENTCOMPANY>${escapedCompanyName}</SVCURRENTCOMPANY>`,
    "      </STATICVARIABLES>",
    "    </DESC>",
    "    <DATA>",
    "      <TALLYMESSAGE xmlns:UDF=\"TallyUDF\">",
    ...voucherElements,
    "      </TALLYMESSAGE>",
    "    </DATA>",
    "  </BODY>",
    "</ENVELOPE>"
  ].join("\n");
}

export function parseTallyImportResponse(xml: string): TallyImportSummary {
  const status = readNumberTag(xml, "STATUS");
  const created = readNumberTag(xml, "CREATED") ?? 0;
  const altered = readNumberTag(xml, "ALTERED") ?? 0;
  const errors = readNumberTag(xml, "ERRORS") ?? 0;
  const lastVchId = readTextTag(xml, "LASTVCHID");
  const lineErrors = readAllTextTags(xml, "LINEERROR");

  return {
    status,
    created,
    altered,
    errors,
    lastVchId,
    lineErrors
  };
}

function isSuccessfulImport(summary: TallyImportSummary): boolean {
  if (summary.status === 0) {
    return false;
  }

  if (summary.errors > 0) {
    return false;
  }

  return summary.created > 0 || summary.altered > 0 || summary.status === 1;
}

export function formatTallyDate(primaryDate?: string | null, fallbackDate?: Date): string {
  if (primaryDate) {
    const normalized = normalizeDateInput(primaryDate);
    if (normalized) {
      return normalized;
    }
  }

  const date = fallbackDate ?? new Date();
  return [
    date.getFullYear().toString().padStart(4, "0"),
    (date.getMonth() + 1).toString().padStart(2, "0"),
    date.getDate().toString().padStart(2, "0")
  ].join("");
}

function normalizeDateInput(value: string): string | null {
  const clean = value.trim();

  if (/^\d{8}$/.test(clean)) {
    return clean;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return clean.replace(/-/g, "");
  }

  const parsed = new Date(clean);
  if (Number.isNaN(parsed.valueOf())) {
    return null;
  }

  return [
    parsed.getFullYear().toString().padStart(4, "0"),
    (parsed.getMonth() + 1).toString().padStart(2, "0"),
    parsed.getDate().toString().padStart(2, "0")
  ].join("");
}

function readNumberTag(xml: string, tagName: string): number | null {
  const value = readTextTag(xml, tagName);
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function readTextTag(xml: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(xml);
  if (!match?.[1]) {
    return null;
  }

  return decodeXml(match[1]).trim();
}

function readAllTextTags(xml: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  const values: string[] = [];

  let match: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(xml))) {
    const value = match[1]?.trim();
    if (value) {
      values.push(decodeXml(value));
    }
  }

  return values;
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

function isAxiosErrorLike(
  error: unknown
): error is { message: string; response?: { data?: unknown } } {
  return typeof error === "object" && error !== null && "message" in error;
}

function buildNarration(invoice: InvoiceDocument): string {
  const parts = [
    `Source=${invoice.sourceType}:${invoice.sourceKey}`,
    `Attachment=${invoice.attachmentName}`,
    `InternalId=${String(invoice._id)}`
  ];

  return parts.join(" | ");
}

function formatAmount(amountMinor: number, currency?: string): string {
  return minorUnitsToMajorString(amountMinor, currency);
}

function isPositiveAmount(value?: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
