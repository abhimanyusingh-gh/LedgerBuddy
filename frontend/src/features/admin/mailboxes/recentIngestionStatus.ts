import type { BadgeTone } from "@/components/ds";
import { STATUS_LABELS } from "@/lib/invoice/invoiceView";

export interface InvoiceStatusPresentation {
  label: string;
  tone: BadgeTone;
}

const INVOICE_STATUS_TONES: Record<string, BadgeTone> = {
  PENDING: "neutral",
  PARSED: "success",
  NEEDS_REVIEW: "warning",
  AWAITING_APPROVAL: "info",
  FAILED_OCR: "danger",
  FAILED_PARSE: "danger",
  FAILED: "danger",
  APPROVED: "success",
  EXPORTED: "info",
  PENDING_TRIAGE: "warning",
  REJECTED: "danger"
};

const FALLBACK_PRESENTATION: InvoiceStatusPresentation = {
  label: "Unknown",
  tone: "neutral"
};

export function getInvoiceStatusPresentation(status: string | null | undefined): InvoiceStatusPresentation {
  if (!status) return FALLBACK_PRESENTATION;
  const label = STATUS_LABELS[status];
  const tone = INVOICE_STATUS_TONES[status];
  if (label !== undefined && tone !== undefined) {
    return { label, tone };
  }
  const humanLabel =
    label ??
    status
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return { label: humanLabel, tone: tone ?? "neutral" };
}
