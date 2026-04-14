import { isPositiveMinorUnits, minorUnitsToMajorString } from "../../utils/currency.js";

export interface TallyGstLedgerConfig {
  cgstLedger: string;
  sgstLedger: string;
  igstLedger: string;
  cessLedger: string;
}

export interface TallyExporterConfig {
  endpoint: string;
  companyName: string;
  purchaseLedgerName: string;
  gstLedgers?: TallyGstLedgerConfig;
  tdsLedgerPrefix?: string;
  tcsLedgerName?: string;
}

interface TallyImportSummary {
  status: number | null;
  created: number;
  altered: number;
  errors: number;
  lastVchId: string | null;
  lineErrors: string[];
}

export interface GstAmounts {
  subtotalMinor: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  cessMinor?: number;
}

export interface TdsExportData {
  section: string;
  amountMinor: number;
  ledgerName: string;
}

export interface TcsExportData {
  amountMinor: number;
  ledgerName: string;
}

export interface VoucherPayloadInput {
  companyName: string;
  purchaseLedgerName: string;
  voucherNumber: string;
  partyLedgerName: string;
  amountMinor: number;
  currency?: string;
  date: string;
  narration?: string;
  gstin?: string;
  gst?: GstAmounts;
  gstLedgers?: TallyGstLedgerConfig;
  tds?: TdsExportData;
  tcs?: TcsExportData;
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

function buildVoucherElement(input: VoucherPayloadInput): string {
  const voucherNumber = xmlEscape(input.voucherNumber);
  const partyLedgerName = xmlEscape(input.partyLedgerName);
  const purchaseLedgerName = xmlEscape(input.purchaseLedgerName);
  const narration = xmlEscape(input.narration ?? "Invoice import from BillForge");
  const tcsAmountMinor = (input.tcs && input.tcs.amountMinor > 0) ? input.tcs.amountMinor : 0;
  const partyTotalMinor = Math.abs(input.amountMinor) + tcsAmountMinor;
  const totalAmount = formatAmount(partyTotalMinor, input.currency);

  const lines: string[] = [
    "        <VOUCHER VCHTYPE=\"Purchase\" ACTION=\"Create\" OBJVIEW=\"Accounting Voucher View\">",
    `          <DATE>${input.date}</DATE>`,
    "          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
    `          <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>`,
    "          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
    "          <ISINVOICE>No</ISINVOICE>",
    `          <PARTYLEDGERNAME>${partyLedgerName}</PARTYLEDGERNAME>`,
    `          <NARRATION>${narration}</NARRATION>`
  ];

  if (input.gstin) {
    lines.push(`          <PARTYGSTIN>${xmlEscape(input.gstin)}</PARTYGSTIN>`);
  }

  lines.push(
    "          <LEDGERENTRIES.LIST>",
    `            <LEDGERNAME>${partyLedgerName}</LEDGERNAME>`,
    "            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
    "            <ISPARTYLEDGER>Yes</ISPARTYLEDGER>",
    "            <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>",
    `            <AMOUNT>-${totalAmount}</AMOUNT>`,
    "          </LEDGERENTRIES.LIST>"
  );

  if (input.gst && input.gstLedgers) {
    const subtotal = formatAmount(Math.abs(input.gst.subtotalMinor), input.currency);
    lines.push(
      "          <LEDGERENTRIES.LIST>",
      `            <LEDGERNAME>${purchaseLedgerName}</LEDGERNAME>`,
      "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
      `            <AMOUNT>${subtotal}</AMOUNT>`,
      "          </LEDGERENTRIES.LIST>"
    );

    if (isPositiveMinorUnits(input.gst.cgstMinor)) {
      const cgst = formatAmount(Math.abs(input.gst.cgstMinor!), input.currency);
      lines.push(
        "          <LEDGERENTRIES.LIST>",
        `            <LEDGERNAME>${xmlEscape(input.gstLedgers.cgstLedger)}</LEDGERNAME>`,
        "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
        `            <AMOUNT>${cgst}</AMOUNT>`,
        "          </LEDGERENTRIES.LIST>"
      );
    }

    if (isPositiveMinorUnits(input.gst.sgstMinor)) {
      const sgst = formatAmount(Math.abs(input.gst.sgstMinor!), input.currency);
      lines.push(
        "          <LEDGERENTRIES.LIST>",
        `            <LEDGERNAME>${xmlEscape(input.gstLedgers.sgstLedger)}</LEDGERNAME>`,
        "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
        `            <AMOUNT>${sgst}</AMOUNT>`,
        "          </LEDGERENTRIES.LIST>"
      );
    }

    if (isPositiveMinorUnits(input.gst.igstMinor)) {
      const igst = formatAmount(Math.abs(input.gst.igstMinor!), input.currency);
      lines.push(
        "          <LEDGERENTRIES.LIST>",
        `            <LEDGERNAME>${xmlEscape(input.gstLedgers.igstLedger)}</LEDGERNAME>`,
        "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
        `            <AMOUNT>${igst}</AMOUNT>`,
        "          </LEDGERENTRIES.LIST>"
      );
    }

    if (isPositiveMinorUnits(input.gst.cessMinor)) {
      const cess = formatAmount(Math.abs(input.gst.cessMinor!), input.currency);
      lines.push(
        "          <LEDGERENTRIES.LIST>",
        `            <LEDGERNAME>${xmlEscape(input.gstLedgers.cessLedger)}</LEDGERNAME>`,
        "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
        `            <AMOUNT>${cess}</AMOUNT>`,
        "          </LEDGERENTRIES.LIST>"
      );
    }
  } else {
    lines.push(
      "          <LEDGERENTRIES.LIST>",
      `            <LEDGERNAME>${purchaseLedgerName}</LEDGERNAME>`,
      "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
      `            <AMOUNT>${totalAmount}</AMOUNT>`,
      "          </LEDGERENTRIES.LIST>"
    );
  }

  if (input.tds && input.tds.amountMinor > 0) {
    const tdsAmount = formatAmount(Math.abs(input.tds.amountMinor), input.currency);
    lines.push(
      "          <LEDGERENTRIES.LIST>",
      `            <LEDGERNAME>${xmlEscape(input.tds.ledgerName)}</LEDGERNAME>`,
      "            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>",
      `            <AMOUNT>-${tdsAmount}</AMOUNT>`,
      "          </LEDGERENTRIES.LIST>"
    );
  }

  if (input.tcs && input.tcs.amountMinor > 0) {
    const tcsAmount = formatAmount(Math.abs(input.tcs.amountMinor), input.currency);
    lines.push(
      "          <LEDGERENTRIES.LIST>",
      `            <LEDGERNAME>${xmlEscape(input.tcs.ledgerName)}</LEDGERNAME>`,
      "            <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>",
      `            <AMOUNT>${tcsAmount}</AMOUNT>`,
      "          </LEDGERENTRIES.LIST>"
    );
  }

  lines.push("        </VOUCHER>");
  return lines.join("\n");
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

function formatAmount(amountMinor: number, currency?: string): string {
  return minorUnitsToMajorString(amountMinor, currency);
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

export function isSuccessfulImport(summary: TallyImportSummary): boolean {
  if (summary.status === 0) {
    return false;
  }

  if (summary.errors > 0) {
    return false;
  }

  return summary.created > 0 || summary.altered > 0 || summary.status === 1;
}
