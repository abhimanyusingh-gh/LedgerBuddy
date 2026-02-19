import type { Invoice } from "./types";
import { formatMinorAmountWithCurrency } from "./currency";

export interface ExtractedFieldRow {
  label: string;
  value: string;
}

export function getExtractedFieldRows(invoice: Invoice): ExtractedFieldRow[] {
  return [
    { label: "Invoice Number", value: invoice.parsed?.invoiceNumber ?? "-" },
    { label: "Vendor Name", value: invoice.parsed?.vendorName ?? "-" },
    { label: "Invoice Date", value: invoice.parsed?.invoiceDate ?? "-" },
    { label: "Due Date", value: invoice.parsed?.dueDate ?? "-" },
    {
      label: "Total Amount",
      value: formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency)
    },
    { label: "Currency", value: invoice.parsed?.currency ?? "-" },
    { label: "OCR Engine", value: invoice.ocrProvider ?? "-" },
    { label: "Extraction Source", value: invoice.metadata?.extractionSource ?? "-" },
    { label: "Extraction Strategy", value: invoice.metadata?.extractionStrategy ?? "-" },
    { label: "OCR Confidence", value: formatOcrConfidenceLabel(invoice.ocrConfidence) }
  ];
}

export function formatOcrConfidenceLabel(value?: number): string {
  if (value === undefined || Number.isNaN(value)) {
    return "-";
  }

  const normalized = value > 1 ? value : value * 100;
  const bounded = Math.max(0, Math.min(100, normalized));
  return `${Math.round(bounded)}%`;
}
