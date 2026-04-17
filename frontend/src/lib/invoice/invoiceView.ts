import type { SourceHighlight } from "@/lib/invoice/sourceHighlights";
import type { InvoiceStatus } from "@/types";

export type CropSource =
  | { type: "url"; url: string }
  | { type: "bbox"; pageImageUrl: string; bboxNormalized: [number, number, number, number] };

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
  EXPORTED: "Exported"
};

export function buildFieldCropUrlMap(
  invoiceId: string,
  highlights: SourceHighlight[],
  resolveCropUrl: (invoiceId: string, blockIndex: number) => string,
  resolvePageImageUrl?: (invoiceId: string, page: number) => string
): Partial<Record<SourceHighlight["fieldKey"], CropSource>> {
  const output: Partial<Record<SourceHighlight["fieldKey"], CropSource>> = {};
  for (const highlight of highlights) {
    if (typeof highlight.blockIndex === "number" && highlight.blockIndex >= 0 && highlight.cropPath) {
      output[highlight.fieldKey] = { type: "url", url: resolveCropUrl(invoiceId, highlight.blockIndex) };
      continue;
    }
    if (resolvePageImageUrl && highlight.bboxNormalized) {
      const pageImageUrl = resolvePageImageUrl(invoiceId, highlight.page);
      if (pageImageUrl) {
        output[highlight.fieldKey] = {
          type: "bbox",
          pageImageUrl,
          bboxNormalized: highlight.bboxNormalized
        };
      }
    }
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
