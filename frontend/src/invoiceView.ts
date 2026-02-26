import { minorUnitsToMajorString } from "./currency";
import type { SourceHighlight } from "./sourceHighlights";
import type { Invoice, InvoiceStatus } from "./types";

export const STATUSES: Array<InvoiceStatus | "ALL"> = [
  "ALL",
  "PARSED",
  "NEEDS_REVIEW",
  "FAILED_OCR",
  "FAILED_PARSE",
  "APPROVED",
  "EXPORTED"
];

export interface EditInvoiceFormState {
  invoiceNumber: string;
  vendorName: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  totalAmountMajor: string;
}

export const EMPTY_EDIT_FORM: EditInvoiceFormState = {
  invoiceNumber: "",
  vendorName: "",
  invoiceDate: "",
  dueDate: "",
  currency: "",
  totalAmountMajor: ""
};

export function buildEditForm(invoice: Invoice): EditInvoiceFormState {
  return {
    invoiceNumber: invoice.parsed?.invoiceNumber ?? "",
    vendorName: invoice.parsed?.vendorName ?? "",
    invoiceDate: invoice.parsed?.invoiceDate ?? "",
    dueDate: invoice.parsed?.dueDate ?? "",
    currency: invoice.parsed?.currency ?? "",
    totalAmountMajor:
      typeof invoice.parsed?.totalAmountMinor === "number"
        ? minorUnitsToMajorString(invoice.parsed.totalAmountMinor, invoice.parsed?.currency)
        : ""
  };
}

export function normalizeTextInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeAmountInput(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildFieldCropUrlMap(
  invoiceId: string,
  highlights: SourceHighlight[],
  resolveCropUrl: (invoiceId: string, blockIndex: number) => string
): Partial<Record<SourceHighlight["fieldKey"], string>> {
  const output: Partial<Record<SourceHighlight["fieldKey"], string>> = {};
  for (const highlight of highlights) {
    if (typeof highlight.blockIndex !== "number" || highlight.blockIndex < 0 || !highlight.cropPath) {
      continue;
    }
    output[highlight.fieldKey] = resolveCropUrl(invoiceId, highlight.blockIndex);
  }
  return output;
}

export function buildFieldOverlayUrlMap(
  invoiceId: string,
  highlights: SourceHighlight[],
  resolveOverlayUrl: (invoiceId: string, fieldKey: SourceHighlight["fieldKey"]) => string
): Partial<Record<SourceHighlight["fieldKey"], string>> {
  const output: Partial<Record<SourceHighlight["fieldKey"], string>> = {};
  for (const highlight of highlights) {
    if (!highlight.overlayPath) {
      continue;
    }
    output[highlight.fieldKey] = resolveOverlayUrl(invoiceId, highlight.fieldKey);
  }
  return output;
}
