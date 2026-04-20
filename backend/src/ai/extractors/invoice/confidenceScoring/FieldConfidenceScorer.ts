import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import { PROVENANCE_SOURCE } from "@/types/invoice.js";
import type { InvoiceFieldKey, InvoiceFieldProvenance, ParsedInvoiceData, ProvenanceSource } from "@/types/invoice.js";
import { clampProbability } from "@/utils/math.js";
import { normalizeConfidence } from "@/utils/math.js";
import {
  DEFAULT_FIELD_LABEL_PATTERNS,
  findBlockByLabelProximity,
  findBlockForField,
} from "@/ai/extractors/invoice/stages/groundingText.js";
import { findBlockByAmountValue } from "@/ai/extractors/invoice/stages/groundingAmounts.js";

const TOP_LEVEL_FIELD_KEYS = [
  "invoiceNumber",
  "vendorName",
  "vendorAddress",
  "vendorGstin",
  "vendorPan",
  "customerName",
  "customerAddress",
  "customerGstin",
  "invoiceDate",
  "dueDate",
  "currency",
  "totalAmountMinor",
  "notes",
  "pan",
  "bankAccountNumber",
  "bankIfsc"
] as const;

function extractFieldEntries(parsed: ParsedInvoiceData): Array<{ key: InvoiceFieldKey; value: unknown }> {
  const entries: Array<{ key: InvoiceFieldKey; value: unknown }> = [];

  for (const key of TOP_LEVEL_FIELD_KEYS) {
    if (parsed[key] !== undefined) {
      entries.push({ key, value: parsed[key] });
    }
  }

  if (parsed.gst) {
    for (const [gstKey, gstValue] of Object.entries(parsed.gst)) {
      if (gstValue !== undefined) {
        entries.push({ key: `gst.${gstKey}` as InvoiceFieldKey, value: gstValue });
      }
    }
  }

  return entries;
}

function getFieldValue(parsed: ParsedInvoiceData, key: InvoiceFieldKey): unknown {
  if (!key.includes(".")) {
    return parsed[key as keyof ParsedInvoiceData];
  }
  const [parent, child] = key.split(".");
  return (parsed[parent as keyof ParsedInvoiceData] as Record<string, unknown> | undefined)?.[child];
}

function resolveFieldConfidence(
  field: InvoiceFieldKey,
  verifierFieldConfidence: Partial<Record<InvoiceFieldKey, number>> | undefined,
  verifierFieldProvenance: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> | undefined,
  ocrConfidence: number
): number {
  const slmConfidence = verifierFieldConfidence?.[field];
  if (typeof slmConfidence === "number" && Number.isFinite(slmConfidence)) {
    return normalizeConfidence(slmConfidence);
  }

  const extractConfidence = verifierFieldProvenance?.[field]?.confidence;
  if (typeof extractConfidence === "number" && Number.isFinite(extractConfidence)) {
    return Number(clampProbability(extractConfidence).toFixed(4));
  }

  return Number(clampProbability(ocrConfidence).toFixed(4));
}

function resolveFieldProvenance(
  field: InvoiceFieldKey,
  value: unknown,
  providerProvenance: InvoiceFieldProvenance | undefined,
  ocrBlocks: OcrBlock[],
  fieldRegions: OcrBlock[],
  source: ProvenanceSource,
  confidence: number | undefined
): InvoiceFieldProvenance {
  if (providerProvenance) {
    return {
      source: providerProvenance.source ?? source,
      page: providerProvenance.page ?? 1,
      ...(providerProvenance.bbox ? { bbox: providerProvenance.bbox } : {}),
      ...(providerProvenance.bboxNormalized ? { bboxNormalized: providerProvenance.bboxNormalized } : {}),
      ...(providerProvenance.bboxModel ? { bboxModel: providerProvenance.bboxModel } : {}),
      ...(typeof providerProvenance.blockIndex === "number" ? { blockIndex: providerProvenance.blockIndex } : {}),
      confidence: providerProvenance.confidence ?? confidence
    };
  }

  let matched: { block: OcrBlock; index: number } | undefined;

  if (field.startsWith("gst.") && typeof value === "number") {
    matched = findBlockByAmountValue(value, ocrBlocks, DEFAULT_FIELD_LABEL_PATTERNS[field]);
  }

  if (!matched) {
    matched =
      findBlockForField(field as keyof ParsedInvoiceData, value, ocrBlocks, fieldRegions)
      ?? findBlockByLabelProximity(field as keyof ParsedInvoiceData, ocrBlocks);
  }

  if (matched) {
    return {
      source,
      page: matched.block.page,
      bbox: matched.block.bbox,
      ...(matched.block.bboxNormalized ? { bboxNormalized: matched.block.bboxNormalized } : {}),
      ...(matched.block.bboxModel ? { bboxModel: matched.block.bboxModel } : {}),
      blockIndex: matched.index,
      confidence
    };
  }

  return { source, page: 1, confidence };
}

export function calibrateDocumentConfidence(
  baseConfidence: number | undefined,
  rawText: string,
  blockText: string
): { score: number; lowTokenRatio: number; printableRatio: number } {
  const sourceText = [rawText, blockText].filter((entry) => entry.length > 0).join("\n");
  if (sourceText.trim().length === 0) {
    return {
      score: 0,
      lowTokenRatio: 1,
      printableRatio: 0
    };
  }

  const tokens = sourceText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const lowTokenCount = tokens.filter((token) => isLowQualityToken(token)).length;
  const lowTokenRatio = tokens.length > 0 ? lowTokenCount / tokens.length : 1;

  const printableCount = [...sourceText].filter((char) => (char >= " " && char <= "~") || char === "\n").length;
  const printableRatio = printableCount / Math.max(1, sourceText.length);
  const safeBase = Number.isFinite(baseConfidence) ? baseConfidence! : 0;
  const score = clampProbability(safeBase);

  const finalScore = Number(score.toFixed(4));
  const finalLowTokenRatio = Number(lowTokenRatio.toFixed(4));
  const finalPrintableRatio = Number(printableRatio.toFixed(4));

  return {
    score: Number.isFinite(finalScore) ? finalScore : 0,
    lowTokenRatio: Number.isFinite(finalLowTokenRatio) ? finalLowTokenRatio : 1,
    printableRatio: Number.isFinite(finalPrintableRatio) ? finalPrintableRatio : 0
  };
}

export function buildFieldDiagnostics(params: {
  parsed: ParsedInvoiceData;
  ocrBlocks: OcrBlock[];
  fieldRegions: Record<string, OcrBlock[]>;
  source: string;
  ocrConfidence?: number;
  templateAppliedFields: Set<string>;
  verifierChangedFields: string[];
  verifierFieldConfidence?: Partial<Record<InvoiceFieldKey, number>>;
  verifierFieldProvenance?: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>;
}): { fieldConfidence: Partial<Record<InvoiceFieldKey, number>>; fieldProvenance: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> } {
  const ocrConfidence = clampProbability(params.ocrConfidence ?? 0);
  const changedByVerifier = new Set(params.verifierChangedFields);
  const fieldEntries = extractFieldEntries(params.parsed);

  const fieldConfidence: Partial<Record<InvoiceFieldKey, number>> = {};
  const fieldProvenance: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> = {};

  for (const { key, value } of fieldEntries) {
    fieldConfidence[key] = resolveFieldConfidence(key, params.verifierFieldConfidence, params.verifierFieldProvenance, ocrConfidence);

    const source: ProvenanceSource = changedByVerifier.has(key)
      ? PROVENANCE_SOURCE.SLM
      : params.templateAppliedFields.has(key)
        ? PROVENANCE_SOURCE.TEMPLATE
        : params.source.includes("template")
          ? PROVENANCE_SOURCE.TEMPLATE
          : PROVENANCE_SOURCE.TEXT_PATTERN;

    fieldProvenance[key] = resolveFieldProvenance(
      key,
      value,
      params.verifierFieldProvenance?.[key],
      params.ocrBlocks,
      params.fieldRegions[key as keyof ParsedInvoiceData] ?? [],
      source,
      fieldConfidence[key]
    );
  }

  return { fieldConfidence, fieldProvenance };
}

function isLowQualityToken(token: string): boolean {
  if (token.length <= 1) {
    return true;
  }

  const alphaNumCount = [...token].filter((char) => /[a-z0-9]/i.test(char)).length;
  const ratio = alphaNumCount / token.length;
  if (ratio < 0.5) {
    return true;
  }

  if (/([A-Za-z])\1\1/.test(token)) {
    return true;
  }

  return /[^\w.,:/\-₹$€£]/.test(token);
}

export { extractFieldEntries, getFieldValue, resolveFieldConfidence, resolveFieldProvenance };
