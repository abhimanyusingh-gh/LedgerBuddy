import type { InvoiceExtractionData, InvoiceFieldProvenance, InvoiceLineItemProvenance, InvoiceFieldKey } from "@/types/invoice.js";
import type { ExtractionSource } from "@/core/engine/extractionSource.js";
import { normalizeBoxTuple } from "@/services/ingestion/box.js";
import { normalizeConfidence } from "@/utils/math.js";

const EXTRACTION_KEY_DOT_TOKEN = "__dot__";

export type FieldProvenanceEntry = InvoiceFieldProvenance;

export function encodeExtractionFieldKey(field: string): string {
  return field.replace(/\./g, EXTRACTION_KEY_DOT_TOKEN);
}

export function parseFieldProvenance(value: string | undefined): Record<string, FieldProvenanceEntry> {
  if (!value) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const output: Record<string, FieldProvenanceEntry> = {};
  for (const [field, rawEntry] of Object.entries(parsed)) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }

    const candidate = rawEntry as Partial<FieldProvenanceEntry>;
    const bbox = normalizeBoxTuple(candidate.bbox);
    const bboxNormalized = normalizeBoxTuple(candidate.bboxNormalized);
    const bboxModel = normalizeBoxTuple(candidate.bboxModel);
    if (!bbox && !bboxNormalized && !bboxModel) {
      continue;
    }

    output[field] = {
      source: typeof candidate.source === "string" ? candidate.source : undefined,
      page: typeof candidate.page === "number" && Number.isFinite(candidate.page) ? Math.max(1, Math.round(candidate.page)) : 1,
      ...(bbox ? { bbox } : {}),
      ...(bboxNormalized ? { bboxNormalized } : {}),
      ...(bboxModel ? { bboxModel } : {}),
      ...(typeof candidate.blockIndex === "number" && Number.isFinite(candidate.blockIndex)
        ? { blockIndex: Math.max(0, Math.round(candidate.blockIndex)) }
        : {}),
      ...(typeof candidate.confidence === "number" && Number.isFinite(candidate.confidence)
        ? { confidence: normalizeConfidence(candidate.confidence) }
        : {})
    };
  }

  return output;
}

export function sanitizeFieldProvenanceRecord(
  value: Record<string, InvoiceFieldProvenance> | undefined
): Record<string, FieldProvenanceEntry> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const output: Record<string, FieldProvenanceEntry> = {};
  for (const [field, rawEntry] of Object.entries(value)) {
    if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
      continue;
    }
    const candidate = rawEntry as Partial<FieldProvenanceEntry>;
    const bbox = normalizeBoxTuple(candidate.bbox);
    const bboxNormalized = normalizeBoxTuple(candidate.bboxNormalized);
    const bboxModel = normalizeBoxTuple(candidate.bboxModel);
    if (!bbox && !bboxNormalized && !bboxModel) {
      continue;
    }
    const confidence = Number(candidate.confidence);
    output[field] = {
      source: typeof candidate.source === "string" ? candidate.source : undefined,
      page: typeof candidate.page === "number" && Number.isFinite(candidate.page) ? Math.max(1, Math.round(candidate.page)) : 1,
      ...(bbox ? { bbox } : {}),
      ...(bboxNormalized ? { bboxNormalized } : {}),
      ...(bboxModel ? { bboxModel } : {}),
      ...(typeof candidate.blockIndex === "number" && Number.isFinite(candidate.blockIndex)
        ? { blockIndex: Math.max(0, Math.round(candidate.blockIndex)) }
        : {}),
      ...(Number.isFinite(confidence)
        ? { confidence: normalizeConfidence(confidence) }
        : {})
    };
  }
  return output;
}

export function flattenLineItemProvenance(lineItems: InvoiceLineItemProvenance[]): Record<string, FieldProvenanceEntry> {
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return {};
  }

  const output: Record<string, FieldProvenanceEntry> = {};
  for (const entry of lineItems) {
    if (!entry || typeof entry.index !== "number" || !Number.isInteger(entry.index) || entry.index < 0) {
      continue;
    }
    const baseKey = `lineItems.${entry.index}`;
    if (entry.row) {
      const normalized = sanitizeFieldProvenanceRecord({ row: entry.row }).row;
      if (normalized) {
        output[`${baseKey}.row`] = normalized;
      }
    }
    if (!entry.fields || typeof entry.fields !== "object") {
      continue;
    }
    const sanitizedFields = sanitizeFieldProvenanceRecord(entry.fields);
    for (const [fieldName, provenance] of Object.entries(sanitizedFields)) {
      output[`${baseKey}.${fieldName}`] = provenance;
    }
  }
  return output;
}

export function normalizeExtractionData(value: InvoiceExtractionData | undefined): InvoiceExtractionData | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const source = typeof value.source === "string" && value.source.trim().length > 0 ? value.source.trim() as ExtractionSource : undefined;
  const strategy = typeof value.strategy === "string" && value.strategy.trim().length > 0 ? value.strategy.trim() as ExtractionSource : undefined;
  const invoiceType =
    typeof value.invoiceType === "string" && value.invoiceType.trim().length > 0 ? value.invoiceType.trim() : undefined;
  const classification =
    value.classification && typeof value.classification === "object"
      ? {
          ...(typeof value.classification.invoiceType === "string" && value.classification.invoiceType.trim().length > 0
            ? { invoiceType: value.classification.invoiceType.trim() }
            : {}),
          ...(typeof value.classification.category === "string" && value.classification.category.trim().length > 0
            ? { category: value.classification.category.trim() }
            : {}),
          ...(typeof value.classification.tdsSection === "string" && value.classification.tdsSection.trim().length > 0
            ? { tdsSection: value.classification.tdsSection.trim() }
            : {})
        }
      : undefined;

  const fieldConfidence: Partial<Record<InvoiceFieldKey, number>> = {};
  if (value.fieldConfidence && typeof value.fieldConfidence === "object") {
    for (const [field, rawValue] of Object.entries(value.fieldConfidence)) {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      fieldConfidence[encodeExtractionFieldKey(field) as InvoiceFieldKey] = normalizeConfidence(parsed);
    }
  }

  const fieldProvenanceRaw = sanitizeFieldProvenanceRecord(value.fieldProvenance);
  const fieldProvenance: Partial<Record<InvoiceFieldKey, FieldProvenanceEntry>> = Object.fromEntries(
    Object.entries(fieldProvenanceRaw).map(([field, provenance]) => [encodeExtractionFieldKey(field) as InvoiceFieldKey, provenance])
  );
  const lineItemProvenance = Array.isArray(value.lineItemProvenance) ? value.lineItemProvenance : [];

  const normalized: InvoiceExtractionData = {
    ...(source ? { source } : {}),
    ...(strategy ? { strategy } : {}),
    ...(invoiceType ? { invoiceType } : {}),
    ...(classification && Object.keys(classification).length > 0 ? { classification } : {}),
    ...(Object.keys(fieldConfidence).length > 0 ? { fieldConfidence } : {}),
    ...(Object.keys(fieldProvenance).length > 0 ? { fieldProvenance } : {}),
    ...(lineItemProvenance.length > 0 ? { lineItemProvenance } : {})
  };

  if (value.fieldOverlayPaths && typeof value.fieldOverlayPaths === "object") {
    const overlayPaths: Partial<Record<InvoiceFieldKey, string>> = {};
    for (const [field, path] of Object.entries(value.fieldOverlayPaths)) {
      if (typeof path === "string" && path.trim().length > 0) {
        overlayPaths[encodeExtractionFieldKey(field) as InvoiceFieldKey] = path.trim();
      }
    }
    if (Object.keys(overlayPaths).length > 0) {
      normalized.fieldOverlayPaths = overlayPaths;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
