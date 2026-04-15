import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import { PROVENANCE_SOURCE } from "@/types/invoice.js";
import type { InvoiceFieldKey, InvoiceFieldProvenance, ParsedInvoiceData, ProvenanceSource } from "@/types/invoice.js";
import { clampProbability } from "@/ai/extractors/stages/fieldParsingUtils.js";
import {
  blockMatchesFieldValue,
  DEFAULT_FIELD_LABEL_PATTERNS,
  findBlockByLabelProximity,
  findBlockForField,
  findPreferredDateValueBlock
} from "@/ai/extractors/invoice/stages/groundingText.js";
import { findBlockByAmountValue } from "@/ai/extractors/invoice/stages/groundingAmounts.js";

const ADDRESS_RE = /\b(address|warehouse|village|road|street|taluk|district|postal|zip)\b/i;

function looksLikeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

const VALIDATION_KEY_BY_FIELD: Record<string, string> = {
  totalAmountMinor: "total amount",
  vendorName: "vendor",
  invoiceNumber: "invoice number",
  currency: "currency",
  dueDate: "due date",
  invoiceDate: "invoice date"
};

function inferHeuristicConfidence(field: keyof ParsedInvoiceData, value: unknown, warningText: string): number {
  if (field === "totalAmountMinor") {
    if (typeof value !== "number" || value <= 0) {
      return 0.45;
    }
    return warningText.includes("total amount") ? 0.7 : 0.92;
  }
  if (field === "vendorName") {
    if (typeof value !== "string") {
      return 0.45;
    }
    if (looksLikeAddress(value)) {
      return 0.5;
    }
    return warningText.includes("vendor name") ? 0.68 : 0.9;
  }
  if (field === "invoiceNumber") {
    return warningText.includes("invoice number") ? 0.65 : 0.9;
  }
  if (field === "currency") {
    return warningText.includes("currency") ? 0.7 : 0.88;
  }
  return 0.82;
}

function inferValidationBonus(field: keyof ParsedInvoiceData, validationText: string): number {
  const key = VALIDATION_KEY_BY_FIELD[field] ?? field;
  return validationText.includes(key) ? 0.7 : 1;
}

export function scoreFieldConfidence(
  field: keyof ParsedInvoiceData,
  value: unknown,
  warningText: string,
  validationText: string,
  ocrConfidence: number
): number {
  const heuristicConfidence = inferHeuristicConfidence(field, value, warningText);
  const validationBonus = inferValidationBonus(field, validationText);
  return clampProbability(ocrConfidence * heuristicConfidence * validationBonus);
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
  const base = clampProbability(baseConfidence ?? 0.75);
  const score = clampProbability(base * 0.8 + (1 - lowTokenRatio) * 0.15 + printableRatio * 0.05);

  return {
    score: Number(score.toFixed(4)),
    lowTokenRatio: Number(lowTokenRatio.toFixed(4)),
    printableRatio: Number(printableRatio.toFixed(4))
  };
}

export function addFieldDiagnosticsToMetadata(params: {
  metadata: Record<string, string>;
  parsed: ParsedInvoiceData;
  ocrBlocks: OcrBlock[];
  fieldRegions: Record<string, OcrBlock[]>;
  source: string;
  ocrConfidence?: number;
  validationIssues: string[];
  warnings: string[];
  templateAppliedFields: Set<string>;
  verifierChangedFields: string[];
  slmBlockIndices?: Record<string, number>;
  verifierFieldConfidence?: Partial<Record<InvoiceFieldKey, number>>;
  verifierFieldProvenance?: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>;
}): { fieldConfidence: Partial<Record<InvoiceFieldKey, number>>; fieldProvenance: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> } {
  const fieldNames: InvoiceFieldKey[] = [
    "invoiceNumber",
    "vendorName",
    "invoiceDate",
    "dueDate",
    "currency",
    "totalAmountMinor",
    "gst.gstin",
    "gst.subtotalMinor",
    "gst.cgstMinor",
    "gst.sgstMinor",
    "gst.igstMinor",
    "gst.cessMinor",
    "gst.totalTaxMinor"
  ];

  const ocrConfidence = clampProbability(params.ocrConfidence ?? 0.75);
  const validationText = params.validationIssues.join(" ").toLowerCase();
  const warningText = params.warnings.join(" ").toLowerCase();
  const changedByVerifier = new Set(params.verifierChangedFields);

  const fieldConfidence: Partial<Record<InvoiceFieldKey, number>> = {};
  const fieldProvenance: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> = {};

  for (const field of fieldNames) {
    let value: unknown;
    if (field.includes(".")) {
      const [parent, child] = field.split(".");
      value = (params.parsed[parent as keyof ParsedInvoiceData] as Record<string, unknown> | undefined)?.[child];
    } else {
      value = params.parsed[field as keyof ParsedInvoiceData];
    }
    if (value === undefined) {
      continue;
    }

    const slmConfidence = params.verifierFieldConfidence?.[field];
    if (typeof slmConfidence === "number" && Number.isFinite(slmConfidence)) {
      const normalized = slmConfidence > 1 ? slmConfidence / 100 : slmConfidence;
      fieldConfidence[field] = Number(clampProbability(normalized).toFixed(4));
    } else {
      const finalConfidence = scoreFieldConfidence(field as keyof ParsedInvoiceData, value, warningText, validationText, ocrConfidence);
      fieldConfidence[field] = Number(finalConfidence.toFixed(4));
    }

    const provenanceSource: ProvenanceSource = changedByVerifier.has(field)
      ? PROVENANCE_SOURCE.SLM
      : params.templateAppliedFields.has(field)
        ? PROVENANCE_SOURCE.TEMPLATE
        : params.source.includes("template")
          ? PROVENANCE_SOURCE.TEMPLATE
          : PROVENANCE_SOURCE.HEURISTIC;
    const slmProvenance = params.verifierFieldProvenance?.[field];
    if (slmProvenance) {
      const provenanceBlock =
        typeof slmProvenance.blockIndex === "number" &&
        slmProvenance.blockIndex >= 0 &&
        slmProvenance.blockIndex < params.ocrBlocks.length
          ? params.ocrBlocks[slmProvenance.blockIndex]
          : undefined;
      const dateValueMatch =
        (field === "invoiceDate" || field === "dueDate") && typeof value === "string"
          ? findPreferredDateValueBlock(field as "invoiceDate" | "dueDate", value, params.ocrBlocks)
          : undefined;
      const labelAlignedMatch =
        (field === "invoiceDate" || field === "dueDate")
          ? findBlockByLabelProximity(field as keyof ParsedInvoiceData, params.ocrBlocks)
          : undefined;
      let correctedMatch: { block: OcrBlock; index: number } | undefined;
      if (dateValueMatch && dateValueMatch.index !== slmProvenance.blockIndex) {
        correctedMatch = dateValueMatch;
      } else if (
        labelAlignedMatch &&
        blockMatchesFieldValue(field, value, labelAlignedMatch.block) &&
        labelAlignedMatch.index !== slmProvenance.blockIndex
      ) {
        correctedMatch = labelAlignedMatch;
      } else if (!blockMatchesFieldValue(field, value, provenanceBlock)) {
        correctedMatch =
          labelAlignedMatch && blockMatchesFieldValue(field, value, labelAlignedMatch.block)
            ? labelAlignedMatch
            : findBlockForField(
                field as keyof ParsedInvoiceData,
                value,
                params.ocrBlocks,
                params.fieldRegions[field as keyof ParsedInvoiceData] ?? []
              );
      }
      const shouldUseCorrectedMatch =
        !!correctedMatch &&
        (
          !provenanceBlock ||
          field === "invoiceDate" ||
          field === "dueDate" ||
          !blockMatchesFieldValue(field, value, provenanceBlock)
        );
      const selectedMatch = shouldUseCorrectedMatch ? correctedMatch : undefined;
      fieldProvenance[field] = {
        source: slmProvenance.source ?? provenanceSource,
        page: selectedMatch ? selectedMatch.block.page : slmProvenance.page ?? 1,
        ...(selectedMatch?.block.bbox
          ? { bbox: selectedMatch.block.bbox }
          : slmProvenance.bbox
            ? { bbox: slmProvenance.bbox }
            : {}),
        ...(selectedMatch?.block.bboxNormalized
          ? { bboxNormalized: selectedMatch.block.bboxNormalized }
          : slmProvenance.bboxNormalized
            ? { bboxNormalized: slmProvenance.bboxNormalized }
            : {}),
        ...(selectedMatch?.block.bboxModel
          ? { bboxModel: selectedMatch.block.bboxModel }
          : slmProvenance.bboxModel
            ? { bboxModel: slmProvenance.bboxModel }
            : {}),
        ...(typeof selectedMatch?.index === "number"
          ? { blockIndex: selectedMatch.index }
          : typeof slmProvenance.blockIndex === "number"
            ? { blockIndex: slmProvenance.blockIndex }
            : {}),
        ...(typeof slmProvenance.confidence === "number"
          ? { confidence: slmProvenance.confidence }
          : { confidence: fieldConfidence[field] })
      };
      continue;
    }

    const slmBlockIndex = params.slmBlockIndices?.[field];
    let matched: { block: OcrBlock; index: number } | undefined;
    if (typeof slmBlockIndex === "number" && slmBlockIndex >= 0 && slmBlockIndex < params.ocrBlocks.length) {
      matched = { block: params.ocrBlocks[slmBlockIndex], index: slmBlockIndex };
    } else {
      if (field.startsWith("gst.") && typeof value === "number") {
        matched = findBlockByAmountValue(value, params.ocrBlocks, DEFAULT_FIELD_LABEL_PATTERNS[field]);
      }
      if (!matched) {
        matched =
          findBlockForField(
            field as keyof ParsedInvoiceData,
            value,
            params.ocrBlocks,
            params.fieldRegions[field as keyof ParsedInvoiceData] ?? []
          ) ?? findBlockByLabelProximity(field as keyof ParsedInvoiceData, params.ocrBlocks);
      }
    }
    const block = matched?.block;
    if (block) {
      fieldProvenance[field] = {
        source: provenanceSource,
        page: block.page,
        bbox: block.bbox,
        ...(block.bboxNormalized ? { bboxNormalized: block.bboxNormalized } : {}),
        ...(block.bboxModel ? { bboxModel: block.bboxModel } : {}),
        ...(typeof matched?.index === "number" ? { blockIndex: matched.index } : {}),
        confidence: fieldConfidence[field]
      };
    } else {
      fieldProvenance[field] = {
        source: provenanceSource,
        page: 1,
        confidence: fieldConfidence[field]
      };
    }
  }

  params.metadata.fieldConfidence = JSON.stringify(fieldConfidence);
  params.metadata.fieldProvenance = JSON.stringify(fieldProvenance);
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
