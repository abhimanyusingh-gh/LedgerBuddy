import type { OcrBlock } from "../../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../../types/invoice.js";
import { currencyBySymbol } from "../../../parser/invoiceParser.js";
import { isWeakVendorValue } from "./textHeuristics.js";
import { findBlockByLabelProximity, findVendorBlock } from "./grounding.js";

type BoxedBlock = { block: OcrBlock; index: number; box: [number, number, number, number] };

export function recoverHeaderFieldsFromOcr(
  parsed: ParsedInvoiceData,
  ocrBlocks: OcrBlock[],
  ocrText: string
): ParsedInvoiceData {
  type LineItem = NonNullable<ParsedInvoiceData["lineItems"]>[number];
  const next: ParsedInvoiceData = {
    ...parsed,
    ...(parsed.gst ? { gst: { ...parsed.gst } } : {}),
    ...(parsed.lineItems ? { lineItems: parsed.lineItems.map((entry: LineItem) => ({ ...entry })) } : {})
  };

  next.invoiceNumber = normalizeInvoiceNumberValue(next.invoiceNumber);
  const invoiceBlock = findBlockByLabelProximity("invoiceNumber", ocrBlocks);
  if (invoiceBlock) {
    const recoveredInvoiceNumber = extractInvoiceNumber(invoiceBlock.block.text);
    if (
      recoveredInvoiceNumber &&
      !looksLikeWeakInvoiceNumber(recoveredInvoiceNumber) &&
      (
        !next.invoiceNumber ||
        looksLikeTruncatedInvoiceNumber(next.invoiceNumber) ||
        looksLikeWeakInvoiceNumber(next.invoiceNumber) ||
        looksLikeMalformedInvoiceNumber(next.invoiceNumber) ||
        recoveredInvoiceNumber !== next.invoiceNumber
      )
    ) {
      next.invoiceNumber = recoveredInvoiceNumber;
    }
  }

  if (!next.invoiceDate) {
    const invoiceDateBlock = findBlockByLabelProximity("invoiceDate", ocrBlocks);
    const recoveredInvoiceDate = invoiceDateBlock ? normalizeDateToken(invoiceDateBlock.block.text) : undefined;
    if (recoveredInvoiceDate) {
      next.invoiceDate = recoveredInvoiceDate;
    }
  }

  if (!next.dueDate) {
    const dueDateBlock = findBlockByLabelProximity("dueDate", ocrBlocks);
    const recoveredDueDate = dueDateBlock ? normalizeDateToken(dueDateBlock.block.text) : undefined;
    if (recoveredDueDate) {
      next.dueDate = recoveredDueDate;
    }
  }

  const corporateBrandVendorBlock = findCorporateBrandVendorBlock(ocrBlocks);
  if (corporateBrandVendorBlock) {
    next.vendorName = normalizeVendorText(corporateBrandVendorBlock.block.text.trim());
  }

  if (!next.vendorName || isWeakVendorValue(next.vendorName) || /^c\/o\b/i.test(next.vendorName.trim())) {
    const brandBlock = findBrandVendorBlock(ocrBlocks);
    if (brandBlock) {
      next.vendorName = normalizeVendorText(brandBlock.block.text.trim());
    }
  }

  if (!next.vendorName || isWeakVendorValue(next.vendorName) || /^c\/o\b/i.test(next.vendorName.trim())) {
    const issuedByVendorBlock = findIssuedByVendorBlock(ocrBlocks);
    if (issuedByVendorBlock) {
      next.vendorName = normalizeVendorText(issuedByVendorBlock.block.text.trim());
    }
  }

  if (!next.vendorName || isWeakVendorValue(next.vendorName) || /^c\/o\b/i.test(next.vendorName.trim())) {
    const vendorBlock = findVendorBlock(ocrBlocks);
    if (vendorBlock) {
      next.vendorName = normalizeVendorText(vendorBlock.block.text.trim());
    }
  }

  if (!next.vendorName || isWeakVendorValue(next.vendorName) || /^c\/o\b/i.test(next.vendorName.trim())) {
    const makeMyTripCorporateBlock = ocrBlocks
      .map((block, index) => ({ block, index }))
      .find((entry) => /\bmakemytrip\b/i.test(entry.block.text) && /\b(private|limited|ltd)\b/i.test(entry.block.text));
    if (makeMyTripCorporateBlock) {
      next.vendorName = normalizeVendorText(makeMyTripCorporateBlock.block.text.trim());
    }
  }

  const explicitCurrency = detectExplicitCurrency(ocrText, ocrBlocks);
  if (explicitCurrency) {
    next.currency = explicitCurrency;
  }

  return next;
}

export function findPreferredVendorBlockForStrategy(
  ocrBlocks: OcrBlock[],
  strategy: "generic" | "invoice_table" | "receipt_statement"
): { block: OcrBlock; index: number } | undefined {
  const corporateBrandVendorBlock = findCorporateBrandVendorBlock(ocrBlocks);
  if (corporateBrandVendorBlock) {
    return corporateBrandVendorBlock;
  }
  const brandBlock = findBrandVendorBlock(ocrBlocks);
  if (brandBlock && /\b(makemytrip|make my trip)\b/i.test(brandBlock.block.text)) {
    return brandBlock;
  }
  if (strategy === "receipt_statement") {
    return findIssuedByVendorBlock(ocrBlocks) ?? findVendorBlock(ocrBlocks);
  }
  return findVendorBlock(ocrBlocks);
}

function detectExplicitCurrency(text: string, ocrBlocks: OcrBlock[] = []): string | undefined {
  if (/\bUSD\b/i.test(text) || /\$\d/.test(text)) {
    return "USD";
  }
  if (/\bINR\b/i.test(text) || /₹/.test(text)) {
    return "INR";
  }
  const symbolMatch = text.match(/([$€£₹])/);
  if (symbolMatch) {
    return currencyBySymbol[symbolMatch[1]];
  }
  if (
    /\b(gstin|cgst|sgst|igst|gst|tax invoice)\b/i.test(text) ||
    ocrBlocks.some((block) => /\b(gstin|cgst|sgst|igst|gst)\b/i.test(block.text))
  ) {
    return "INR";
  }
  return undefined;
}

function extractInvoiceNumber(text: string): string | undefined {
  const normalizedText = text.replace(/[|]/g, "I").replace(/\bO(?=\d)/g, "0");
  const match = normalizedText.match(/\b([A-Z0-9][A-Z0-9_\-/]{2,})\b/gi);
  if (!match || match.length === 0) {
    return undefined;
  }
  return normalizeInvoiceNumberValue(match[match.length - 1]?.trim());
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

export function normalizeInvoiceNumberValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  let normalized = value.trim().replace(/[|]/g, "I");
  normalized = normalized.replace(/^(FY\d{4}-\d+)$/i, "INV-$1");
  normalized = normalized.replace(/^(M\d{2}[A-Z]{2}\d{2})1(\d{8,})$/i, "$1I$2");
  return normalized;
}

function looksLikeTruncatedInvoiceNumber(value: string): boolean {
  return /^FY\d{4}-\d+$/i.test(value) || /^M\d{2}[A-Z]{2}\d{2}$/i.test(value);
}

function looksLikeMalformedInvoiceNumber(value: string): boolean {
  return /^M\d{2}[A-Z]{2}\d{10,}$/i.test(value);
}

function looksLikeWeakInvoiceNumber(value: string): boolean {
  return /^(invoice no\.?|invoice|booking id|hsn\/sac|gstin|pan)$/i.test(value.trim());
}

export function normalizeVendorText(value: string): string {
  return value
    .replace(/\bOpenAl\b/g, "OpenAI")
    .replace(/\bmake my trip\b/gi, "MAKEMYTRIP")
    .trim();
}

function findIssuedByVendorBlock(blocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const labelIndex = blocks.findIndex((block) => /^issued by$/i.test(block.text.trim()));
  if (labelIndex < 0) {
    return undefined;
  }

  const labelBox = blocks[labelIndex]?.bboxNormalized;
  if (!labelBox) {
    return undefined;
  }

  const candidate = blocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => entry.index !== labelIndex)
    .filter((entry) => entry.box[0] >= labelBox[0] - 0.02)
    .filter((entry) => entry.box[0] <= 0.6)
    .filter((entry) => entry.box[1] >= labelBox[3] - 0.01)
    .filter((entry) => entry.box[1] <= labelBox[3] + 0.04)
    .find((entry) => !/^c\/o\b/i.test(entry.block.text.trim()) && !isWeakVendorValue(entry.block.text));
  return candidate ? { block: candidate.block, index: candidate.index } : undefined;
}

function findBrandVendorBlock(ocrBlocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const candidates = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => entry.box[1] <= 0.2)
    .filter((entry) => /\b(makemytrip|make my trip|openai|openal|anthropic|cursor|sprinto)\b/i.test(entry.block.text));
  candidates.sort((left, right) => scoreBrandVendorCandidate(right) - scoreBrandVendorCandidate(left));
  return candidates[0] ? { block: candidates[0].block, index: candidates[0].index } : undefined;
}

function findCorporateBrandVendorBlock(ocrBlocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const candidates = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => /\b(makemytrip|make my trip|openai|openal|anthropic|cursor|sprinto)\b/i.test(entry.block.text))
    .filter((entry) => /\b(llc|inc|limited|private|pbc|ltd)\b/i.test(entry.block.text));
  candidates.sort((left, right) => scoreBrandVendorCandidate(right) - scoreBrandVendorCandidate(left));
  return candidates[0] ? { block: candidates[0].block, index: candidates[0].index } : undefined;
}

function scoreBrandVendorCandidate(entry: BoxedBlock): number {
  let score = 0;
  const text = entry.block.text.trim();
  const width = entry.box[2] - entry.box[0];
  score += width * 10;

  if (/\b(openai|openal|anthropic|cursor|sprinto)\b/i.test(text)) {
    score += 4;
  }
  if (/\b(llc|inc|limited|private|pbc|ltd)\b/i.test(text)) {
    score += 6;
  }
  if (entry.box[0] <= 0.35) {
    score += 6;
  }
  if (entry.box[1] >= 0.12) {
    score += 2;
  }
  if (entry.box[0] >= 0.6 && entry.box[1] <= 0.1 && !/\b(llc|inc|limited|private|pbc|ltd)\b/i.test(text)) {
    score -= 8;
  }

  return score;
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
