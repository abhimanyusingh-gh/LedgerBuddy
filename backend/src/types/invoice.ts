export const InvoiceStatuses = [
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED_OCR",
  "FAILED_PARSE",
  "APPROVED",
  "EXPORTED"
] as const;

export type InvoiceStatus = (typeof InvoiceStatuses)[number];

export interface GstBreakdown {
  gstin?: string;
  subtotalMinor?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  cessMinor?: number;
  totalTaxMinor?: number;
}

export interface ParsedInvoiceData {
  invoiceNumber?: string;
  vendorName?: string;
  invoiceDate?: string;
  dueDate?: string;
  totalAmountMinor?: number;
  currency?: string;
  notes?: string[];
  gst?: GstBreakdown;
}
