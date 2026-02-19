import type { Invoice } from "./types";
import { formatMinorAmountWithCurrency, minorUnitsToMajorString } from "./currency";

export interface TallyMappingRow {
  label: string;
  detectedValue: string;
  tallyField: string;
  mappedValue: string;
}

export function getInvoiceTallyMappings(invoice: Invoice): TallyMappingRow[] {
  const totalAmountMinor = invoice.parsed?.totalAmountMinor;
  const absoluteTotalAmountMinor = Number.isInteger(totalAmountMinor) ? Math.abs(totalAmountMinor as number) : 0;
  const partyLedgerName = invoice.parsed?.vendorName ?? "Unknown Vendor";

  return [
    {
      label: "Invoice Number",
      detectedValue: invoice.parsed?.invoiceNumber ?? "-",
      tallyField: "VOUCHER.VOUCHERNUMBER",
      mappedValue: invoice.parsed?.invoiceNumber ?? invoice._id
    },
    {
      label: "Vendor Name",
      detectedValue: invoice.parsed?.vendorName ?? "-",
      tallyField: "VOUCHER.PARTYLEDGERNAME, LEDGERENTRIES[0].LEDGERNAME",
      mappedValue: partyLedgerName
    },
    {
      label: "Invoice Date",
      detectedValue: invoice.parsed?.invoiceDate ?? "-",
      tallyField: "VOUCHER.DATE",
      mappedValue: formatTallyDateForUi(invoice.parsed?.invoiceDate, invoice.receivedAt)
    },
    {
      label: "Total Amount",
      detectedValue: formatMinorAmountWithCurrency(totalAmountMinor, invoice.parsed?.currency),
      tallyField: "LEDGERENTRIES[0].AMOUNT, LEDGERENTRIES[1].AMOUNT",
      mappedValue: `-${minorUnitsToMajorString(absoluteTotalAmountMinor, invoice.parsed?.currency)} / ${minorUnitsToMajorString(absoluteTotalAmountMinor, invoice.parsed?.currency)}`
    },
    {
      label: "Purchase Ledger",
      detectedValue: "From backend config",
      tallyField: "LEDGERENTRIES[1].LEDGERNAME",
      mappedValue: "TALLY_PURCHASE_LEDGER"
    },
    {
      label: "Company",
      detectedValue: "From backend config",
      tallyField: "STATICVARIABLES.SVCURRENTCOMPANY",
      mappedValue: "TALLY_COMPANY"
    },
    {
      label: "Narration",
      detectedValue: "Derived from source metadata",
      tallyField: "VOUCHER.NARRATION",
      mappedValue: buildNarration(invoice)
    }
  ];
}

export function formatTallyDateForUi(primaryDate?: string | null, fallbackDate?: string): string {
  if (primaryDate) {
    const normalized = normalizeDateInput(primaryDate);
    if (normalized) {
      return normalized;
    }
  }

  const fallback = fallbackDate ? new Date(fallbackDate) : new Date();
  const date = Number.isNaN(fallback.valueOf()) ? new Date() : fallback;
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

function buildNarration(invoice: Invoice): string {
  return `Source=${invoice.sourceType}:${invoice.sourceKey} | Attachment=${invoice.attachmentName} | InternalId=${invoice._id}`;
}
