import type { OcrBlock } from "../../core/interfaces/OcrProvider.js";
import type { DetectedInvoiceLanguage } from "./languageDetection.js";
import { findBlockByLabelProximity } from "./pipeline/grounding.js";

export function buildKeyValueGroundingText(blocks: OcrBlock[]): string {
  if (blocks.length < 2) {
    return "";
  }

  const labelPattern =
    /\b(invoice(?:\s*number)?|facture|factuurnummer|rechnungsnummer|vendor|supplier|fournisseur|due(?:\s*date)?|date|total|amount|currency|betrag|montant|numero)\b/i;

  const normalizedBlocks = blocks
    .map((block) => ({
      block,
      bbox: block.bboxNormalized ?? block.bboxModel ?? block.bbox,
      text: block.text.trim()
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((left, right) => {
      if (left.block.page !== right.block.page) {
        return left.block.page - right.block.page;
      }
      return left.bbox[1] - right.bbox[1];
    });

  const lines: string[] = [];
  for (const entry of normalizedBlocks) {
    const labelText = entry.text.replace(/[:\-]+$/, "").trim();
    if (!labelPattern.test(labelText)) {
      continue;
    }

    const scale = inferBlockScale(entry.bbox);
    const maxYDrift = scale === "normalized" ? 0.06 : 42;
    const minXDrift = scale === "normalized" ? -0.03 : -24;
    const labelRight = entry.bbox[2];
    const labelCenterY = (entry.bbox[1] + entry.bbox[3]) / 2;
    const candidate = normalizedBlocks
      .filter((blockEntry) => blockEntry.block.page === entry.block.page && blockEntry.block !== entry.block)
      .map((blockEntry) => {
        const valueCenterY = (blockEntry.bbox[1] + blockEntry.bbox[3]) / 2;
        const yDrift = Math.abs(valueCenterY - labelCenterY);
        const xDrift = blockEntry.bbox[0] - labelRight;
        return {
          ...blockEntry,
          yDrift,
          xDrift
        };
      })
      .filter((blockEntry) => blockEntry.xDrift >= minXDrift && blockEntry.yDrift <= maxYDrift)
      .sort((left, right) => {
        if (left.yDrift !== right.yDrift) {
          return left.yDrift - right.yDrift;
        }
        return left.xDrift - right.xDrift;
      })[0];

    if (!candidate) {
      continue;
    }

    const valueText = candidate.text.replace(/\s+/g, " ").trim();
    if (!valueText || labelPattern.test(valueText) || valueText.length > 100) {
      continue;
    }

    lines.push(`${labelText}: ${valueText}`);
  }

  return [...new Set(lines)].join("\n");
}

export function buildAugmentedGroundingText(keyValueText: string, blockText: string, rawText: string): string {
  const sections = [keyValueText, blockText, rawText]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (sections.length < 2) {
    return "";
  }

  return sections.join("\n\n");
}

export function resolvePreOcrLanguageHint(
  language: DetectedInvoiceLanguage,
  mimeType: string
): { hint?: string; reason: "detected" | "low-confidence-detected" | "default-en" | "none" } {
  if (language.code !== "und") {
    return {
      hint: language.code,
      reason: shouldUseLanguageHint(language) ? "detected" : "low-confidence-detected"
    };
  }

  if (isDocumentMimeType(mimeType)) {
    return {
      hint: "en",
      reason: "default-en"
    };
  }

  return {
    reason: "none"
  };
}

export function resolveDetectedLanguage(
  preOcrLanguage: DetectedInvoiceLanguage,
  postOcrLanguage: DetectedInvoiceLanguage
): DetectedInvoiceLanguage {
  if (postOcrLanguage.code === "und") {
    return preOcrLanguage;
  }

  if (preOcrLanguage.code === "und") {
    return postOcrLanguage;
  }

  if (postOcrLanguage.code === preOcrLanguage.code) {
    return {
      code: postOcrLanguage.code,
      confidence: clampProbability(Math.max(postOcrLanguage.confidence, preOcrLanguage.confidence)),
      signals: uniqueIssues([...postOcrLanguage.signals, ...preOcrLanguage.signals])
    };
  }

  if (postOcrLanguage.confidence >= preOcrLanguage.confidence - 0.12) {
    return postOcrLanguage;
  }

  return preOcrLanguage;
}

export function formatConfidence(value: number): string {
  return clampProbability(value).toFixed(4);
}

function selectDateProvenanceBlock(
  field: "invoiceDate" | "dueDate",
  value: string,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  const labelAligned = findBlockByLabelProximity(field, blocks);
  if (labelAligned) {
    const text = labelAligned.block.text.replace(/,/g, "").trim().replace(/[|]/g, "I");
    if (
      text.includes(value) ||
      normalizeDateValue(text) === value
    ) {
      return labelAligned;
    }
  }
  const monthNames: Record<string, string> = {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };
  const normalizeDateText = (text: string): string | undefined => normalizeDateValue(text, monthNames);

  const matches = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => normalizeDateText(entry.block.text) === value);
  if (matches.length === 0) {
    return undefined;
  }
  return field === "dueDate" ? matches[matches.length - 1] : matches[0];
}

function selectInvoiceNumberProvenanceBlock(
  value: string | undefined,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (!value) {
    return undefined;
  }
  const normalizedValue = normalizeInvoiceNumberForMatch(value);
  const labelAligned = findBlockByLabelProximity("invoiceNumber", blocks);
  if (labelAligned && normalizeInvoiceNumberForMatch(labelAligned.block.text).includes(normalizedValue)) {
    return labelAligned;
  }
  return blocks
    .map((block, index) => ({ block, index }))
    .find((entry) => normalizeInvoiceNumberForMatch(entry.block.text).includes(normalizedValue));
}

export function uniqueIssues(issues: string[]): string[] {
  return [...new Set(issues.map((issue) => issue.trim()).filter((issue) => issue.length > 0))];
}

export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function buildBlocksText(blocks: OcrBlock[]): string {
  if (blocks.length === 0) {
    return "";
  }

  return blocks
    .map((block) => block.text.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(text|table|title|line|image)$/i.test(line))
    .join("\n");
}

function isNearDuplicateText(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight;
}

function shouldUseLanguageHint(language: DetectedInvoiceLanguage): boolean {
  return language.code !== "und" && language.confidence >= 0.4;
}

function isDocumentMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return normalized.startsWith("image/") || normalized === "application/pdf";
}

function inferBlockScale(bbox: [number, number, number, number]): "normalized" | "pixel" {
  if (bbox.every((value) => Number.isFinite(value) && Math.abs(value) <= 2.5)) {
    return "normalized";
  }
  return "pixel";
}

function normalizeInvoiceNumberForMatch(text: string): string {
  return text
    .replace(/[|]/g, "I")
    .replace(/^(M\d{2}[A-Z]{2}\d{2})1(\d{8,})$/i, "$1I$2")
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase();
}

function normalizeDateValue(text: string, monthNamesOverride?: Record<string, string>): string | undefined {
  const monthNames = monthNamesOverride ?? {
    jan: "01",
    january: "01",
    feb: "02",
    february: "02",
    mar: "03",
    march: "03",
    apr: "04",
    april: "04",
    may: "05",
    jun: "06",
    june: "06",
    jul: "07",
    july: "07",
    aug: "08",
    august: "08",
    sep: "09",
    sept: "09",
    september: "09",
    oct: "10",
    october: "10",
    nov: "11",
    november: "11",
    dec: "12",
    december: "12"
  };
  const sanitized = text.replace(/,/g, "").trim();
  let match = sanitized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (match) {
    const month = monthNames[match[1].toLowerCase()];
    if (month) {
      return `${match[3]}-${month}-${String(Number(match[2])).padStart(2, "0")}`;
    }
  }
  match = sanitized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (match) {
    const month = monthNames[match[2].toLowerCase()];
    if (month) {
      return `${match[3]}-${month}-${String(Number(match[1])).padStart(2, "0")}`;
    }
  }
  return undefined;
}
