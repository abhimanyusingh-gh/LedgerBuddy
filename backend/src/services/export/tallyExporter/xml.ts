import { isPositiveMinorUnits, minorUnitsToMajorString } from "@/utils/currency.js";

const TALLY_WRITE_ALIASES = {
  GSTIN: ["PARTYGSTIN", "GSTIN"],
  PAN: ["PANIT", "INCOMETAXNUMBER"],
  STATE_NAME: ["STATENAME", "LEDSTATENAME"]
} as const;

const TALLY_READ_ALIASES = {
  LAST_ENTITY_ID: ["LASTVCHID", "LASTMID"]
} as const;

export const TALLY_ACTION = {
  CREATE: "Create",
  ALTER: "Alter"
} as const;
export type TallyAction = typeof TALLY_ACTION[keyof typeof TALLY_ACTION];

export const TALLY_BATCH_SIZE = 25 as const;

const XML_PROLOG = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>";

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
  date: Date;
  narration?: string;
  gstin?: string;
  partyPan?: string;
  partyStateName?: string | null;
  placeOfSupplyStateName?: string;
  guid?: string;
  action?: TallyAction;
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
  const lastVchId = readAliasedTextTag(xml, TALLY_READ_ALIASES.LAST_ENTITY_ID);
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

export function formatTallyDate(primaryDate?: Date | null, fallbackDate?: Date): string {
  const date = (primaryDate && !isNaN(primaryDate.getTime())) ? primaryDate : (fallbackDate ?? new Date());
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
  const narration = xmlEscape(input.narration ?? "Invoice import from LedgerBuddy");
  const tcsAmountMinor = (input.tcs && input.tcs.amountMinor > 0) ? input.tcs.amountMinor : 0;
  const partyTotalMinor = Math.abs(input.amountMinor) + tcsAmountMinor;
  const totalAmount = formatAmount(partyTotalMinor, input.currency);
  const action: TallyAction = input.action ?? TALLY_ACTION.CREATE;

  const lines: string[] = [
    `        <VOUCHER VCHTYPE="Purchase" ACTION="${action}" OBJVIEW="Accounting Voucher View">`,
    `          <DATE>${formatTallyDate(input.date)}</DATE>`,
    "          <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>",
    `          <VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>`,
    "          <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>",
    "          <ISINVOICE>No</ISINVOICE>",
    `          <PARTYLEDGERNAME>${partyLedgerName}</PARTYLEDGERNAME>`,
    `          <NARRATION>${narration}</NARRATION>`
  ];

  if (input.guid) {
    lines.push(`          <GUID>${xmlEscape(input.guid)}</GUID>`);
  }

  if (input.placeOfSupplyStateName) {
    lines.push(`          <PLACEOFSUPPLY>${xmlEscape(input.placeOfSupplyStateName)}</PLACEOFSUPPLY>`);
  }

  if (input.gstin) {
    lines.push(...dualAliasTags(TALLY_WRITE_ALIASES.GSTIN, input.gstin));
  }

  if (input.partyPan) {
    lines.push(...dualAliasTags(TALLY_WRITE_ALIASES.PAN, input.partyPan));
  }

  if (input.partyStateName) {
    lines.push(...dualAliasTags(TALLY_WRITE_ALIASES.STATE_NAME, input.partyStateName));
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
    XML_PROLOG,
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

export function chunkVoucherInputs<T>(inputs: readonly T[], size: number = TALLY_BATCH_SIZE): T[][] {
  if (size <= 0) {
    throw new Error(`chunkVoucherInputs: size must be > 0 (got ${size})`);
  }
  const chunks: T[][] = [];
  for (let i = 0; i < inputs.length; i += size) {
    chunks.push(inputs.slice(i, i + size));
  }
  return chunks;
}

export function buildTallyBatchImportXmlChunks(
  companyName: string,
  inputs: readonly VoucherPayloadInput[],
  size: number = TALLY_BATCH_SIZE
): string[] {
  return chunkVoucherInputs(inputs, size).map((chunk) => buildTallyBatchImportXml(companyName, chunk as VoucherPayloadInput[]));
}

function readNumberTag(xml: string, tagName: string): number | null {
  const value = readTextTag(xml, tagName);
  if (!value) {
    return null;
  }

  const parsed = Number(value.trim());
  return Number.isNaN(parsed) ? null : parsed;
}

function dualAliasTags(aliases: ReadonlyArray<string>, value: string): string[] {
  const escaped = xmlEscape(value);
  return aliases.map((tag) => `          <${tag}>${escaped}</${tag}>`);
}

function readAliasedTextTag(xml: string, aliases: ReadonlyArray<string>): string | null {
  for (const tag of aliases) {
    const value = readTextTag(xml, tag);
    if (value !== null) {
      return value;
    }
  }
  return null;
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
