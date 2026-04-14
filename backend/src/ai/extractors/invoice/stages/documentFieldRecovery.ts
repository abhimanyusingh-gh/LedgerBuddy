import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import { isWeakVendorValue } from "./fieldCandidates.js";
import { findBlockByLabelProximity, findVendorBlock } from "./groundingText.js";
import { normalizeDateToken, detectExplicitCurrency } from "./fieldParsingUtils.js";

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
  if (!next.invoiceNumber || looksLikeWeakInvoiceNumber(next.invoiceNumber)) {
    const receiptInvoiceNumber = findReceiptStyleInvoiceNumber(ocrBlocks);
    if (receiptInvoiceNumber) {
      next.invoiceNumber = receiptInvoiceNumber;
    }
  }

  if (!next.invoiceDate) {
    const invoiceDateBlock = findBlockByLabelProximity("invoiceDate", ocrBlocks);
    const recoveredInvoiceDate = invoiceDateBlock ? normalizeDateToken(invoiceDateBlock.block.text) : undefined;
    if (recoveredInvoiceDate) {
      next.invoiceDate = recoveredInvoiceDate;
    }
  }
  if (!next.invoiceDate) {
    const explicitInvoiceDateBlock = findExplicitInvoiceDateBlock(ocrBlocks);
    const recoveredInvoiceDate = explicitInvoiceDateBlock ? normalizeDateToken(explicitInvoiceDateBlock.block.text) : undefined;
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

function extractInvoiceNumber(text: string): string | undefined {
  const normalizedText = text.replace(/[|]/g, "I").replace(/\bO(?=\d)/g, "0");
  const receiptMatch = normalizedText.match(/\b(?:receipt|invoice)\s+([A-Z]{1,4}\d{6,})\b/i);
  if (receiptMatch?.[1]) {
    const candidate = receiptMatch[1].trim();
    if (!/^[0-9a-f]{64}$/i.test(candidate) && !/^\d{15,}$/.test(candidate)) {
      return normalizeInvoiceNumberValue(candidate);
    }
  }
  const orderMatch = normalizedText.match(/\border#?\s*([A-Z0-9-]{6,})\b/i);
  if (orderMatch?.[1]) {
    return normalizeInvoiceNumberValue(orderMatch[1].trim());
  }
  const match = normalizedText.match(/\b([A-Z0-9][A-Z0-9_\-/]{2,})\b/gi);
  if (!match || match.length === 0) {
    return undefined;
  }
  const filtered = match.filter((entry) => !/^[0-9a-f]{64}$/i.test(entry) && !/^\d{15,}$/.test(entry));
  if (filtered.length === 0) {
    return undefined;
  }
  return normalizeInvoiceNumberValue(filtered[filtered.length - 1]?.trim());
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
  const trimmed = value.trim();
  if (/^(invoice no\.?|invoice|booking id|hsn\/sac|gstin|pan)$/i.test(trimmed)) {
    return true;
  }
  if (/^[0-9a-f]{64}$/i.test(trimmed) || /^\d{15,}$/.test(trimmed)) {
    return true;
  }
  return false;
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
    .filter((entry) => /\b(makemytrip|make my trip|openai|openal|anthropic|cursor|sprinto|cloudflare|cloudflare,\s*inc)\b/i.test(entry.block.text));
  candidates.sort((left, right) => scoreBrandVendorCandidate(right) - scoreBrandVendorCandidate(left));
  return candidates[0] ? { block: candidates[0].block, index: candidates[0].index } : undefined;
}

function findCorporateBrandVendorBlock(ocrBlocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  const candidates = ocrBlocks
    .map((block, index) => ({ block, index, box: block.bboxNormalized }))
    .filter((entry): entry is BoxedBlock => Boolean(entry.box))
    .filter((entry) => /\b(makemytrip|make my trip|openai|openal|anthropic|cursor|sprinto|cloudflare|cloudflare,\s*inc)\b/i.test(entry.block.text))
    .filter((entry) => /\b(llc|inc|limited|private|pbc|ltd)\b/i.test(entry.block.text));
  candidates.sort((left, right) => scoreBrandVendorCandidate(right) - scoreBrandVendorCandidate(left));
  return candidates[0] ? { block: candidates[0].block, index: candidates[0].index } : undefined;
}

function findReceiptStyleInvoiceNumber(ocrBlocks: OcrBlock[]): string | undefined {
  for (const block of ocrBlocks) {
    if (!/\b(receipt|invoice|order#?)\b/i.test(block.text)) {
      continue;
    }
    const recovered = extractInvoiceNumber(block.text);
    if (recovered && /\d{4,}/.test(recovered) && !looksLikeWeakInvoiceNumber(recovered)) {
      return recovered;
    }
  }
  return undefined;
}

function findExplicitInvoiceDateBlock(ocrBlocks: OcrBlock[]): { block: OcrBlock; index: number } | undefined {
  return ocrBlocks
    .map((block, index) => ({ block, index }))
    .find((entry) => /\b(date paid|date of issue|invoice date|paid on)\b/i.test(entry.block.text));
}

function scoreBrandVendorCandidate(entry: BoxedBlock): number {
  let score = 0;
  const text = entry.block.text.trim();
  const width = entry.box[2] - entry.box[0];
  score += width * 10;

  if (/\b(openai|openal|anthropic|cursor|sprinto|cloudflare|cloudflare,\s*inc)\b/i.test(text)) {
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

