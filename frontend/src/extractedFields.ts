import type { Invoice } from "./types";
import { formatMinorAmountWithCurrency } from "./currency";
import type { SourceFieldKey } from "./sourceHighlights";

export interface ExtractedFieldRow {
  fieldKey: SourceFieldKey | "notes";
  label: string;
  value: string;
}

export function getExtractedFieldRows(invoice: Invoice): ExtractedFieldRow[] {
  const notes =
    Array.isArray(invoice.parsed?.notes) && invoice.parsed.notes.length > 0 ? invoice.parsed.notes.join(" | ") : "-";

  return [
    { fieldKey: "invoiceNumber", label: "Invoice Number", value: invoice.parsed?.invoiceNumber ?? "-" },
    { fieldKey: "vendorName", label: "Vendor Name", value: invoice.parsed?.vendorName ?? "-" },
    { fieldKey: "invoiceDate", label: "Invoice Date", value: invoice.parsed?.invoiceDate ?? "-" },
    { fieldKey: "dueDate", label: "Due Date", value: invoice.parsed?.dueDate ?? "-" },
    {
      fieldKey: "totalAmountMinor",
      label: "Total Amount",
      value: formatMinorAmountWithCurrency(invoice.parsed?.totalAmountMinor, invoice.parsed?.currency)
    },
    { fieldKey: "currency", label: "Currency", value: invoice.parsed?.currency ?? "-" },
    { fieldKey: "notes", label: "Notes", value: notes }
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
