import type { OcrBlock } from "../../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../../types/invoice.js";
import { currencyBySymbol, parseAmountToken } from "../../../parser/invoiceParser.js";
import { looksLikeAddress } from "./textHeuristics.js";
import { FIELD_LABEL_PATTERNS } from "./groundingLabels.js";

export function findBlockByLabelProximity(
  field: keyof ParsedInvoiceData,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  const labelPattern = FIELD_LABEL_PATTERNS[field];
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

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!labelPattern.test(block.text.trim())) {
      continue;
    }

    const labelBbox = block.bbox;
    if (!labelBbox || labelBbox.length < 4) {
      continue;
    }

    const labelTop = labelBbox[1];
    const labelBottom = labelBbox[3];
    const labelRight = labelBbox[2];
    const yOverlapThreshold = (labelBottom - labelTop) * 0.5;

    let bestValue: { block: OcrBlock; index: number; distance: number } | undefined;
    for (let j = 0; j < blocks.length; j++) {
      if (j === i) continue;
      const candidate = blocks[j];
      const cBbox = candidate.bbox;
      if (!cBbox || cBbox.length < 4) continue;

      const cTop = cBbox[1];
      const cBottom = cBbox[3];
      const cLeft = cBbox[0];
      const yOverlap = Math.min(labelBottom, cBottom) - Math.max(labelTop, cTop);
      if (yOverlap < yOverlapThreshold) continue;

      if (cLeft <= labelRight) continue;

      const distance = cLeft - labelRight;
      if (!bestValue || distance < bestValue.distance) {
        bestValue = { block: candidate, index: j, distance };
      }
    }

    if (bestValue) {
      return { block: bestValue.block, index: bestValue.index };
    }
  }

  return undefined;
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

function buildGroundingDateTerms(value: string): string[] {
  const [year, month, day] = value.split("-");
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isInteger(dayNumber)) {
    return [value];
  }

  const monthNames = [
    ["jan", "january"],
    ["feb", "february"],
    ["mar", "march"],
    ["apr", "april"],
    ["may", "may"],
    ["jun", "june"],
    ["jul", "july"],
    ["aug", "august"],
    ["sep", "september"],
    ["oct", "october"],
    ["nov", "november"],
    ["dec", "december"]
  ];
  const [shortMonth, longMonth] = monthNames[monthIndex] ?? [];
  const normalizedDay = String(dayNumber);
  return [value, `${longMonth} ${normalizedDay}, ${year}`, `${shortMonth} ${normalizedDay}, ${year}`].filter(Boolean);
}

function candidateTerms(field: keyof ParsedInvoiceData, value: string): string[] {
  const base = value.trim().toLowerCase();
  if (!base) {
    return [];
  }

  if ((field === "invoiceDate" || field === "dueDate") && /^\d{4}-\d{2}-\d{2}$/.test(base)) {
    return buildGroundingDateTerms(base);
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

function detectExplicitCurrency(text: string): string | undefined {
  if (/\bUSD\b/i.test(text) || /\$\d/.test(text)) {
    return "USD";
  }
  if (/\bINR\b/i.test(text) || /₹/.test(text)) {
    return "INR";
  }
  const symbolMatch = text.match(/([$€£₹])/);
  if (!symbolMatch) {
    return undefined;
  }
  return currencyBySymbol[symbolMatch[1]];
}

function normalizeDateToken(text: string): string | undefined {
  const normalizedText = text.trim().replace(/[|]/g, "I");
  const patterns = [
    /\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/,
    /\b(\d{1,2} [A-Z][a-z]{2} \d{4})\b/,
    /\b([A-Z][a-z]{2} \d{1,2}, \d{4})\b/
  ];
  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match) {
      continue;
    }
    const normalizedDate = normalizeNamedDateValue(match[1]);
    if (normalizedDate) {
      return normalizedDate;
    }
  }
  return undefined;
}

function normalizeNamedDateValue(value: string): string | undefined {
  const sanitized = value.replace(/,/g, "").trim();
  const monthNameFirst = sanitized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (monthNameFirst) {
    const month = resolveMonthNumber(monthNameFirst[1]);
    if (month) {
      return `${monthNameFirst[3]}-${month}-${monthNameFirst[2].padStart(2, "0")}`;
    }
  }

  const dayFirst = sanitized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dayFirst) {
    const month = resolveMonthNumber(dayFirst[2]);
    if (month) {
      return `${dayFirst[3]}-${month}-${dayFirst[1].padStart(2, "0")}`;
    }
  }

  return undefined;
}

function resolveMonthNumber(value: string): string | undefined {
  const months: Record<string, string> = {
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
  return months[value.trim().toLowerCase()];
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
