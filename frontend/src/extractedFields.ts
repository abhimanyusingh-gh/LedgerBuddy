import type { Invoice } from "./types";
import { formatMinorAmountWithCurrency, minorUnitsToMajorString } from "./currency";
import { parseMetadataRecord, type SourceFieldKey } from "./sourceHighlights";

export interface ExtractedFieldRow {
  fieldKey: SourceFieldKey | "notes";
  label: string;
  value: string;
  rawValue?: string;
  confidence?: number;
}

export function getExtractedFieldRows(invoice: Invoice): ExtractedFieldRow[] {
  const notes =
    Array.isArray(invoice.parsed?.notes) && invoice.parsed.notes.length > 0 ? invoice.parsed.notes.join(" | ") : "-";

  const confidenceMap = parseMetadataRecord<number>(invoice.metadata?.fieldConfidence);

  const totalRaw = Number.isInteger(invoice.parsed?.totalAmountMinor)
    ? minorUnitsToMajorString(invoice.parsed!.totalAmountMinor!, invoice.parsed?.currency)
    : undefined;

  return [
    { fieldKey: "invoiceNumber", label: "Invoice Number", value: invoice.parsed?.invoiceNumber ?? "-", rawValue: invoice.parsed?.invoiceNumber, confidence: confidenceMap?.invoiceNumber },
    { fieldKey: "vendorName", label: "Vendor Name", value: invoice.parsed?.vendorName ?? "-", rawValue: invoice.parsed?.vendorName, confidence: confidenceMap?.vendorName },
    { fieldKey: "invoiceDate", label: "Invoice Date", value: invoice.parsed?.invoiceDate ?? "-", rawValue: invoice.parsed?.invoiceDate, confidence: confidenceMap?.invoiceDate },
    { fieldKey: "dueDate", label: "Due Date", value: invoice.parsed?.dueDate ?? "-", rawValue: invoice.parsed?.dueDate, confidence: confidenceMap?.dueDate },
    {
      fieldKey: "totalAmountMinor",
      label: "Total Amount",
      value: formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency),
      rawValue: totalRaw,
      confidence: confidenceMap?.totalAmountMinor
    },
    { fieldKey: "currency", label: "Currency", value: invoice.parsed?.currency ?? "-", rawValue: invoice.parsed?.currency, confidence: confidenceMap?.currency },
    ...getGstRows(invoice),
    { fieldKey: "notes", label: "Notes", value: notes }
  ];
}

function getGstRows(invoice: Invoice): ExtractedFieldRow[] {
  const gst = invoice.parsed?.gst;
  if (!gst) return [];
  const cur = invoice.parsed?.currency;
  const rows: ExtractedFieldRow[] = [];
  if (gst.gstin) {
    rows.push({ fieldKey: "currency" as SourceFieldKey, label: "GSTIN", value: gst.gstin });
  }
  if (gst.subtotalMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "Subtotal", value: formatMinorAmountWithCurrency(gst.subtotalMinor, cur) });
  }
  if (gst.cgstMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "CGST", value: formatMinorAmountWithCurrency(gst.cgstMinor, cur) });
  }
  if (gst.sgstMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "SGST", value: formatMinorAmountWithCurrency(gst.sgstMinor, cur) });
  }
  if (gst.igstMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "IGST", value: formatMinorAmountWithCurrency(gst.igstMinor, cur) });
  }
  if (gst.cessMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "Cess", value: formatMinorAmountWithCurrency(gst.cessMinor, cur) });
  }
  if (gst.totalTaxMinor) {
    rows.push({ fieldKey: "totalAmountMinor" as SourceFieldKey, label: "Total Tax", value: formatMinorAmountWithCurrency(gst.totalTaxMinor, cur) });
  }
  return rows;
}

export function formatOcrConfidenceLabel(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  const normalized = value > 1 ? value : value * 100;
  const bounded = Math.max(0, Math.min(100, normalized));
  return `${Math.round(bounded)}%`;
}
