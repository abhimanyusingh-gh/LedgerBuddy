import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { parseAmountToken } from "@/ai/parsers/invoiceParser.js";
import { looksLikeAddress } from "@/ai/extractors/invoice/stages/fieldCandidates.js";
import { normalizeDateToken, buildDateTerms, detectExplicitCurrency } from "@/ai/extractors/stages/fieldParsingUtils.js";

export const DEFAULT_FIELD_LABEL_PATTERNS: Record<string, RegExp> = {
  invoiceNumber: /^((?:pro(?:forma|perma)?|performa)\s+invoice\s*(?:number|no\.?|#)?|invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#)|inv\s*(?:no\.?|#))$/i,
  vendorName: /^(vendor|supplier|sold\s*by|company|from)$/i,
  invoiceDate: /^(invoice\s*date|bill\s*date|date|dated|date\s*of\s*issue|issue\s*date)$/i,
  dueDate: /^(due\s*date|payment\s*due|date\s*due)$/i,
  totalAmountMinor: /^(grand\s*total|total|total\s*amount|invoice\s*value|invoice\s*total|amount\s*due|balance\s*due|net\s*payable|net\s*amount\s*payable|amount\s*payable)$/i,
  currency: /^(currency)$/i,
  "gst.gstin": /^(gstin|gst\s*(?:no\.?|number|id|in))$/i,
  "gst.subtotalMinor": /^(sub\s*total|subtotal|taxable\s*(?:value|amount))$/i,
  "gst.cgstMinor": /\bcgst(?:\d+)?\b/i,
  "gst.sgstMinor": /\bsgst(?:\d+)?\b/i,
  "gst.igstMinor": /\bigst(?:\d+)?\b/i,
  "gst.cessMinor": /\bcess\b/i,
  "gst.totalTaxMinor": /\b(total\s*tax|tax\s*total|total\s*gst)\b/i
};

type FieldAlignmentProfile = {
  minLeftGap: number;
  maxLeftGap: number;
  rowGap: number;
  maxCandidatesChecked: number;
};

type GroundingAlignmentField =
  | keyof ParsedInvoiceData
  | "gst.gstin"
  | "gst.subtotalMinor"
  | "gst.cgstMinor"
  | "gst.sgstMinor"
  | "gst.igstMinor"
  | "gst.cessMinor"
  | "gst.totalTaxMinor";

const FIELD_ALIGNMENT: Partial<Record<GroundingAlignmentField, FieldAlignmentProfile>> = {
  invoiceNumber: { minLeftGap: -0.12, maxLeftGap: 0.18, rowGap: 0.022, maxCandidatesChecked: 220 },
  vendorName: { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 80 },
  invoiceDate: { minLeftGap: -0.12, maxLeftGap: 0.18, rowGap: 0.018, maxCandidatesChecked: 220 },
  dueDate: { minLeftGap: -0.12, maxLeftGap: 0.18, rowGap: 0.018, maxCandidatesChecked: 220 },
  totalAmountMinor: { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  currency: { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 80 },
  "gst.gstin": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.subtotalMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.cgstMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.sgstMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.igstMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.cessMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 },
  "gst.totalTaxMinor": { minLeftGap: -0.03, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 }
};

function getAlignmentProfile(field: keyof ParsedInvoiceData): FieldAlignmentProfile {
  return FIELD_ALIGNMENT[field] ?? { minLeftGap: -0.5, maxLeftGap: 0.5, rowGap: 0.02, maxCandidatesChecked: 120 };
}

function extractLabelCandidateValue(field: keyof ParsedInvoiceData, text: string): string | undefined {
  const candidate = text.trim();
  if (!candidate) {
    return undefined;
  }
  if (field === "invoiceNumber") {
    const normalizedCandidate = candidate
      .replace(/^\s*[:#\-.]+\s*|\s*[:#\-.]+\s*$/g, "")
      .replace(/\s+/g, " ");
    if (!normalizedCandidate) {
      return undefined;
    }
    if (!/[A-Za-z0-9]/.test(normalizedCandidate)) {
      return undefined;
    }
    if (!/[0-9]/.test(normalizedCandidate)) {
      return undefined;
    }
    if (normalizedCandidate.length < 4) {
      return undefined;
    }
    if (
      /\b(date|net|due|booking|invoice|no\.?|number|hsn|gstin|pan|sac|irn|cin|vat|gst|tax|place|state|supply)\b/i.test(normalizedCandidate)
    ) {
      return undefined;
    }
    if (/^[0-9a-f]{64}$/i.test(normalizedCandidate) || /^\d{15,}$/.test(normalizedCandidate)) {
      return undefined;
    }
    if (looksLikeDateCandidate(normalizedCandidate)) {
      return undefined;
    }
    return normalizedCandidate;
  }
  if (field === "invoiceDate" || field === "dueDate") {
    return normalizeDateToken(candidate) ? candidate : undefined;
  }
  return candidate;
}

function verticalGapBetween(a: [number, number, number, number], b: [number, number, number, number]): number {
  const aTop = a[1];
  const aBottom = a[3];
  const bTop = b[1];
  const bBottom = b[3];
  if (aBottom >= bTop && aTop <= bBottom) {
    return 0;
  }
  if (aBottom < bTop) {
    return bTop - aBottom;
  }
  return aTop - bBottom;
}

export function findBlockByLabelProximity(
  field: keyof ParsedInvoiceData,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  const labelPattern = DEFAULT_FIELD_LABEL_PATTERNS[field];
  if (!labelPattern || blocks.length === 0) {
    return undefined;
  }

  if (field === "vendorName") {
    for (let i = 0; i < Math.min(5, blocks.length); i++) {
      const block = blocks[i];
      const text = block.text.trim();
      if (text.length >= 3 && !/\b(invoice|bill|date|tax|gst|gstin|msme|address)\b/i.test(text)) {
        return { block, index: i };
      }
    }
    return undefined;
  }

  const alignment = getAlignmentProfile(field);
  const isDateField = field === "invoiceDate" || field === "dueDate";
  const isInvoiceNumberField = field === "invoiceNumber";

  const resolveBox = (block: OcrBlock): [number, number, number, number] | undefined => {
    const bbox = block.bboxNormalized ?? block.bbox;
    return bbox?.length === 4 ? bbox as [number, number, number, number] : undefined;
  };

  for (let i = 0; i < blocks.length; i++) {
    if (i >= alignment.maxCandidatesChecked) {
      break;
    }
    const block = blocks[i];
    if (!labelPattern.test(block.text.trim())) {
      continue;
    }

    const labelBbox = resolveBox(block);
    if (!labelBbox) {
      continue;
    }

  const labelRight = labelBbox[2];
  const rowGapThreshold = alignment.rowGap;
  const minLeftGap = alignment.minLeftGap;
  const maxLeftGap = alignment.maxLeftGap;

    let bestValue: { block: OcrBlock; index: number; distance: number } | undefined;
    const dateCandidates: Array<{ block: OcrBlock; index: number; resolvedDate: string; distance: number }> = [];
    for (let j = 0; j < blocks.length; j++) {
      if (j >= alignment.maxCandidatesChecked) {
        break;
      }
      if (j === i) continue;
      if (isInvoiceNumberField && j < i) {
        continue;
      }
      const candidate = blocks[j];
      const cBbox = resolveBox(candidate);
      if (!cBbox) continue;
      const candidateText = extractLabelCandidateValue(field, candidate.text);
      if (!candidateText) {
        continue;
      }

      const cLeft = cBbox[0];
      if (verticalGapBetween(labelBbox, cBbox) > rowGapThreshold) {
        continue;
      }

      const leftGap = cLeft - labelRight;
      if (leftGap < minLeftGap || leftGap > maxLeftGap) continue;

      const distance = leftGap < 0 ? Math.abs(leftGap) + 0.04 : leftGap;
      if (isDateField) {
        const resolvedDate = normalizeDateToken(candidateText);
        if (resolvedDate) {
          dateCandidates.push({ block: candidate, index: j, distance, resolvedDate });
        }
        continue;
      }
      if (!bestValue || distance < bestValue.distance) {
        bestValue = { block: candidate, index: j, distance };
      }
    }

    if (isDateField && dateCandidates.length > 0) {
      dateCandidates.sort((left, right) => {
        if (left.resolvedDate === right.resolvedDate) {
          return left.distance - right.distance;
        }
        return field === "dueDate"
          ? right.resolvedDate.localeCompare(left.resolvedDate)
          : left.resolvedDate.localeCompare(right.resolvedDate);
      });
      return { block: dateCandidates[0].block, index: dateCandidates[0].index };
    }

    if (bestValue) {
      return { block: bestValue.block, index: bestValue.index };
    }
  }

  return undefined;
}

function looksLikeDateCandidate(value: string): boolean {
  return (
    /\b\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}\b/i.test(value) ||
    /\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}\b/i.test(value) ||
    /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(value) ||
    /\b\d{1,2}-\d{1,2}-(19|20)\d{2}\b/.test(value) ||
    /\b\d{1,2}-[A-Za-z]{3,9}-\d{2,4}\b/i.test(value)
  );
}

export function findVendorBlock(blocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const candidates: Array<{ block: OcrBlock; index: number; score: number }> = [];
  for (let index = 0; index < Math.min(blocks.length, 24); index += 1) {
    const block = blocks[index];
    const text = block.text.trim();
    const normalized = text.toLowerCase();
    if (text.length < 3) {
      continue;
    }
    if (/[0-9@]/.test(text)) {
      continue;
    }
    if (/\b(invoice|bill to|ship to|date|due|gst|tax|total|amount|address|payment|page|terms)\b/i.test(normalized)) {
      continue;
    }
    if (looksLikeAddress(text)) {
      continue;
    }
    const box = block.bboxNormalized ?? block.bbox;
    if (!box || box[0] > 0.35 || box[1] > 0.28) {
      continue;
    }
    let score = 10 - index * 0.1;
    if (/[,&.]/.test(text)) {
      score += 2;
    }
    if (/\b(inc|llc|ltd|limited|pbc|private)\b/i.test(text)) {
      score += 3;
    }
    candidates.push({ block, index, score });
  }
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0] ? { block: candidates[0].block, index: candidates[0].index } : undefined;
}

export function findBlockForField(
  field: keyof ParsedInvoiceData,
  value: unknown,
  blocks: OcrBlock[],
  preferredBlocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  const candidate = normalizeFieldValue(field, value);
  if (!candidate) {
    return undefined;
  }

  const terms = candidateTerms(field, candidate);
  if (terms.length === 0) {
    return undefined;
  }

  const preferredSet = new Set(preferredBlocks.map((block) => block.text.trim().toLowerCase()).filter(Boolean));
  let best: { block: OcrBlock; index: number; score: number } | undefined;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const normalizedText = block.text.trim().toLowerCase();
    if (!normalizedText) {
      continue;
    }

    const keywordBonus = fieldKeywordBonus(field, normalizedText);
    let score = keywordBonus;
    let matchedTerms = 0;
    for (const term of terms) {
      if (!containsTerm(normalizedText, term)) {
        continue;
      }
      score += term.length >= 4 ? 4 : 2;
      if (normalizedText === term) {
        score += 2;
      }
      matchedTerms += 1;
    }

    if (preferredSet.has(normalizedText)) {
      score += 4;
    }

    if (matchedTerms > 0 && candidate.length > 0) {
      const valueRatio = candidate.length / Math.max(1, normalizedText.length);
      if (valueRatio > 0.5) {
        score += 3;
      }
      if (valueRatio > 0.8) {
        score += 2;
      }
    }

    if (matchedTerms > 0 && index < blocks.length * 0.3) {
      score += 2;
    }

    if (matchedTerms > 0 && /\b(beneficiary|bank|payment|bill\s*to|ship\s*to)\b/i.test(normalizedText)) {
      score -= 6;
    }

    if (normalizedText.startsWith(":") && matchedTerms > 0) {
      score += 3;
    }

    score -= blockShapePenalty(field, normalizedText);

    if (score <= 0) {
      continue;
    }

    if (field === "totalAmountMinor") {
      if (matchedTerms === 0) {
        continue;
      }
      const hasTotalKeyword = /\b(grand total|invoice total|amount due|balance due|total due|amount payable|total)\b/i.test(
        normalizedText
      );
      if (!hasTotalKeyword && keywordBonus <= 0 && matchedTerms < 2) {
        continue;
      }
    }

    if (!best || score > best.score) {
      best = { block, index, score };
    }
  }

  if (!best) {
    return undefined;
  }

  return { block: best.block, index: best.index };
}

export function blockMatchesFieldValue(field: string, value: unknown, block: OcrBlock | undefined): boolean {
  if (!block) {
    return false;
  }

  const text = block.text.trim();
  if (!text) {
    return false;
  }

  if ((field === "invoiceDate" || field === "dueDate") && typeof value === "string") {
    return normalizeDateToken(text) === value;
  }

  if (field === "totalAmountMinor" && typeof value === "number") {
    const amount = parseAmountToken(text);
    return amount !== null && Math.round(amount * 100) === value;
  }

  if (field === "currency" && typeof value === "string") {
    return detectExplicitCurrency(text) === value;
  }

  if (typeof value === "string") {
    return text.toLowerCase().includes(value.trim().toLowerCase());
  }

  return false;
}

export function findPreferredDateValueBlock(
  field: "invoiceDate" | "dueDate",
  value: string,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  const matches = blocks
    .map((block, index) => ({ block, index }))
    .filter((entry) => normalizeDateToken(entry.block.text) === value);
  if (matches.length === 0) {
    return undefined;
  }
  return field === "dueDate" ? matches[matches.length - 1] : matches[0];
}

export function findBlockIndexByExactText(blocks: OcrBlock[], pattern: RegExp): number {
  return blocks.findIndex((block) => pattern.test(block.text.trim()));
}

function candidateTerms(field: keyof ParsedInvoiceData, value: string): string[] {
  const base = value.trim().toLowerCase();
  if (!base) {
    return [];
  }

  if ((field === "invoiceDate" || field === "dueDate") && /^\d{4}-\d{2}-\d{2}$/.test(base)) {
    return buildDateTerms(base);
  }

  if (field !== "totalAmountMinor") {
    return [base];
  }

  const amount = Number(base);
  if (!Number.isFinite(amount) || amount <= 0) {
    return [base];
  }

  const withDecimals = amount.toFixed(2);
  const noDecimals = Number.isInteger(amount) ? String(amount) : "";
  const digitsOnly = base.replace(/[^0-9]/g, "");

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of [base, withDecimals, noDecimals, digitsOnly]) {
    const entry = raw.trim().toLowerCase();
    if (entry.length >= 3 && !seen.has(entry)) {
      seen.add(entry);
      terms.push(entry);
    }
  }
  return terms;
}

function normalizeFieldValue(field: keyof ParsedInvoiceData, value: unknown): string {
  if (field === "totalAmountMinor") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return "";
    }
    const major = value / 100;
    return Number.isInteger(major) ? String(major) : major.toFixed(2);
  }

  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return field === "currency" ? trimmed.toUpperCase() : trimmed;
}

function fieldKeywordBonus(field: keyof ParsedInvoiceData, text: string): number {
  if (field === "totalAmountMinor") {
    if (/\b(grand total|invoice total|amount due|balance due|total due|amount payable|total)\b/i.test(text)) {
      return 6;
    }
    if (/\b(subtotal|tax|vat|gst|charges|credit|discount)\b/i.test(text)) {
      return -3;
    }
    return 0;
  }

  if (field === "invoiceNumber") {
    return /\b(invoice|inv|bill).*(number|no|#)?\b/i.test(text) ? 4 : 0;
  }

  if (field === "vendorName") {
    if (/\b(vendor|supplier|sold by|bill from|from)\b/i.test(text)) {
      return 3;
    }
    if (looksLikeAddress(text)) {
      return -5;
    }
    return 0;
  }

  if (field === "currency") {
    return /\b(currency)\b/i.test(text) ? 2 : 0;
  }

  if (field === "invoiceDate") {
    return /\b(invoice date|date)\b/i.test(text) ? 2 : 0;
  }

  if (field === "dueDate") {
    return /\b(due date|payment terms)\b/i.test(text) ? 2 : 0;
  }

  return 0;
}

function blockShapePenalty(field: keyof ParsedInvoiceData, text: string): number {
  const lineCount = text
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
  const lengthPenalty = Math.floor(text.length / 160);
  const linePenalty = lineCount > 1 ? Math.min(6, lineCount - 1) : 0;

  if (field === "totalAmountMinor") {
    if (/\b(summary|description|quantity|rate|amount|subtotal|charges)\b/i.test(text) && lineCount > 2) {
      return linePenalty + lengthPenalty + 3;
    }
    return linePenalty + lengthPenalty;
  }

  if (field === "invoiceNumber" || field === "currency" || field === "invoiceDate" || field === "dueDate") {
    return linePenalty + lengthPenalty;
  }

  if (field === "vendorName") {
    if (looksLikeAddress(text)) {
      return linePenalty + lengthPenalty + 4;
    }
    return linePenalty + lengthPenalty;
  }

  return linePenalty + lengthPenalty;
}

function containsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) {
    return false;
  }

  if (/\d/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\d])${escaped}([^\\d]|$)`, "i").test(haystack)) {
      return true;
    }
    const strippedHaystack = haystack.replace(/[,.\s]/g, "");
    return strippedHaystack.includes(term.replace(/[,.\s]/g, ""));
  }

  return haystack.includes(term);
}
