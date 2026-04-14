import type { Invoice } from "@/types";
import { formatMinorAmountWithCurrency, minorUnitsToMajorString } from "@/lib/common/currency";
import { parseMetadataRecord, type SourceFieldKey } from "@/lib/invoice/sourceHighlights";

const EXTRACTION_KEY_DOT_TOKEN = "__dot__";

export interface ExtractedFieldRow {
  fieldKey: SourceFieldKey | "notes" | string;
  label: string;
  value: string;
  rawValue?: string;
  confidence?: number;
}

export function getExtractedFieldRows(invoice: Invoice): ExtractedFieldRow[] {
  const notes =
    Array.isArray(invoice.parsed?.notes) && invoice.parsed.notes.length > 0 ? invoice.parsed.notes.join(" | ") : "-";

  const confidenceMap =
    invoice.extraction?.fieldConfidence && Object.keys(invoice.extraction.fieldConfidence).length > 0
      ? decodeExtractionConfidenceMap(invoice.extraction.fieldConfidence)
      : parseMetadataRecord<number>(invoice.metadata?.fieldConfidence);

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
    rows.push({ fieldKey: "gst.gstin", label: "GSTIN", value: gst.gstin, rawValue: gst.gstin });
  }
  if (gst.subtotalMinor) {
    rows.push({ fieldKey: "gst.subtotalMinor", label: "Subtotal", value: formatMinorAmountWithCurrency(gst.subtotalMinor, cur), rawValue: minorUnitsToMajorString(gst.subtotalMinor, cur) });
  }
  if (gst.cgstMinor) {
    rows.push({ fieldKey: "gst.cgstMinor", label: "CGST", value: formatMinorAmountWithCurrency(gst.cgstMinor, cur), rawValue: minorUnitsToMajorString(gst.cgstMinor, cur) });
  }
  if (gst.sgstMinor) {
    rows.push({ fieldKey: "gst.sgstMinor", label: "SGST", value: formatMinorAmountWithCurrency(gst.sgstMinor, cur), rawValue: minorUnitsToMajorString(gst.sgstMinor, cur) });
  }
  if (gst.igstMinor) {
    rows.push({ fieldKey: "gst.igstMinor", label: "IGST", value: formatMinorAmountWithCurrency(gst.igstMinor, cur), rawValue: minorUnitsToMajorString(gst.igstMinor, cur) });
  }
  if (gst.cessMinor) {
    rows.push({ fieldKey: "gst.cessMinor", label: "Cess", value: formatMinorAmountWithCurrency(gst.cessMinor, cur), rawValue: minorUnitsToMajorString(gst.cessMinor, cur) });
  }
  if (gst.totalTaxMinor) {
    rows.push({ fieldKey: "gst.totalTaxMinor", label: "Total Tax", value: formatMinorAmountWithCurrency(gst.totalTaxMinor, cur), rawValue: minorUnitsToMajorString(gst.totalTaxMinor, cur) });
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

function decodeExtractionConfidenceMap(value: Record<string, number>): Record<string, number> {
  const output: Record<string, number> = {};
  for (const [field, confidence] of Object.entries(value)) {
    output[field.split(EXTRACTION_KEY_DOT_TOKEN).join(".")] = confidence;
  }
  return output;
}
