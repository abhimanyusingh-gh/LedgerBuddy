import type { InvoiceFieldKey, InvoiceFieldProvenance } from "@/types/invoice.js";

type Box4 = [number, number, number, number];

function normalizeBoxTuple(value: unknown): Box4 | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }
  const [x1, y1, x2, y2] = numbers as Box4;
  if (x2 <= x1 || y2 <= y1) {
    return undefined;
  }
  return [x1, y1, x2, y2];
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

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
