import type { InvoiceFieldKey, InvoiceFieldProvenance } from "@/types/invoice.js";
import { normalizeBoxTuple } from "@/services/ingestion/box.js";
import { clampProbability } from "@/utils/math.js";

function normalizeProvenanceEntry(value: unknown): InvoiceFieldProvenance | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const bbox = normalizeBoxTuple(raw.bbox);
  const bboxNormalized = normalizeBoxTuple(raw.bboxNormalized);
  const bboxModel = normalizeBoxTuple(raw.bboxModel);
  if (!bbox && !bboxNormalized && !bboxModel) {
    return undefined;
  }

  const pageCandidate = Number(raw.page);
  const blockIndexCandidate = Number(raw.blockIndex ?? raw.block_index);
  const confidenceCandidate = Number(raw.confidence);
  return {
    ...(typeof raw.source === "string" && raw.source.trim().length > 0 ? { source: raw.source.trim() } : {}),
    ...(Number.isFinite(pageCandidate) && pageCandidate > 0 ? { page: Math.round(pageCandidate) } : {}),
    ...(bbox ? { bbox } : {}),
    ...(bboxNormalized ? { bboxNormalized } : {}),
    ...(bboxModel ? { bboxModel } : {}),
    ...(Number.isInteger(blockIndexCandidate) && blockIndexCandidate >= 0 ? { blockIndex: blockIndexCandidate } : {}),
    ...(Number.isFinite(confidenceCandidate)
      ? { confidence: Number(clampProbability(confidenceCandidate > 1 ? confidenceCandidate / 100 : confidenceCandidate).toFixed(4)) }
      : {})
  };
}

export function normalizeVerifierFieldProvenance(value: unknown): Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const output: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> = {};
  for (const [field, entry] of Object.entries(value)) {
    const normalized = normalizeProvenanceEntry(entry);
    if (normalized) {
      output[field as InvoiceFieldKey] = normalized;
    }
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

export function normalizeVerifierSingleProvenance(value: unknown): InvoiceFieldProvenance | undefined {
  return normalizeProvenanceEntry(value);
}
