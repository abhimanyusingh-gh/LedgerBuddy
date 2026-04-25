import type { SourceHighlight } from "@/lib/invoice/sourceHighlights";
import type { InvoiceStatus } from "@/types";

export type CropSource = {
  type: "bbox";
  pageImageUrl: string;
  bboxNormalized: [number, number, number, number];
};

export const STATUSES: Array<InvoiceStatus | "ALL" | "FAILED"> = [
  "ALL",
  "PARSED",
  "NEEDS_REVIEW",
  "AWAITING_APPROVAL",
  "FAILED",
  "APPROVED",
  "EXPORTED"
];

export const STATUS_LABELS: Record<string, string> = {
  ALL: "All",
  PENDING: "Processing",
  PARSED: "Processed",
  NEEDS_REVIEW: "Needs Review",
  AWAITING_APPROVAL: "Awaiting Approval",
  FAILED: "Failed",
  FAILED_OCR: "Failed",
  FAILED_PARSE: "Failed",
  APPROVED: "Approved",
  EXPORTED: "Exported",
  PENDING_TRIAGE: "Triage",
  REJECTED: "Rejected"
};

export function buildFieldCropSourceMap(
  invoiceId: string,
  highlights: SourceHighlight[],
  resolvePageImageUrl: (invoiceId: string, page: number) => string
): Partial<Record<SourceHighlight["fieldKey"], CropSource>> {
  const output: Partial<Record<SourceHighlight["fieldKey"], CropSource>> = {};
  for (const highlight of highlights) {
    if (!highlight.bboxNormalized) {
      continue;
    }
    const pageImageUrl = resolvePageImageUrl(invoiceId, highlight.page);
    if (!pageImageUrl) {
      continue;
    }
    output[highlight.fieldKey] = {
      type: "bbox",
      pageImageUrl,
      bboxNormalized: highlight.bboxNormalized
    };
  }
  return output;
}
