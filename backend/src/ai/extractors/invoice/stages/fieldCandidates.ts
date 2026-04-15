import { ADDRESS_SIGNAL_PATTERN } from "@/constants/indianCompliance.js";
import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { VendorTemplateSnapshot } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { currencyBySymbol, parseAmountToken } from "@/ai/parsers/invoiceParser.js";
import { buildDateTerms } from "@/ai/extractors/stages/fieldParsingUtils.js";
const WEAK_VENDOR_RE =
  /\b(currency|invoice|total|amount|date|due|tax|gst|vat|number|booking|booking id|customer|bill to|ship to|company legal name|company trade name|trade name|legal name|hsn\/sac|beneficiary|bank account|ifsc|swift|micr)\b/i;
const COUNTRY_LINE_RE = /\b(united states|united kingdom|india|singapore|australia|canada|germany|france)\b/i;

export function looksLikeAddress(value: string): boolean {
  return ADDRESS_SIGNAL_PATTERN.test(value);
}

export function isWeakVendorValue(value: string): boolean {
  return looksLikeAddress(value) || WEAK_VENDOR_RE.test(value) || COUNTRY_LINE_RE.test(value);
}

export function buildFieldCandidates(
  text: string,
  parsed: ParsedInvoiceData,
  template?: VendorTemplateSnapshot
): Record<string, string[]> {
  const invoiceNumberMatches = uniqueStrings([
    parsed.invoiceNumber,
    ...collectMatches(text, /\b(?:pro(?:forma|perma)?|performa)\s+invoice\s*(?:number|no\.?|#)?\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/gi),
    ...collectMatches(text, /\b(?:invoice|bill|inv)\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/gi)
  ]);
  const vendorMatches = uniqueStrings([
    parsed.vendorName,
    template?.vendorName,
    ...collectMatches(
      text,
      /^(?:vendor|supplier|sold\s*by|bill\s*from|from)\s*[:\-]?\s*([A-Za-z0-9&'().,\-\s]{3,})$/gim
    ).map((entry) => entry.split(",")[0].trim())
  ]).filter((entry) => !looksLikeAddress(entry));

  const currencyMatches = uniqueStrings([
    parsed.currency,
    template?.currency,
    ...collectMatches(text, /\b(USD|EUR|GBP|INR|AUD|CAD|JPY|AED|SGD|CHF|CNY)\b/gi).map((entry) =>
      entry.toUpperCase()
    ),
    ...collectMatches(text, /([$€£₹])/g).map((symbol) => currencyBySymbol[symbol] ?? "")
  ]);

  const totalMatches = uniqueStrings([
    parsed.totalAmountMinor !== undefined ? String(parsed.totalAmountMinor) : undefined,
    ...collectMatches(
      text,
      /(?:grand\s*total|invoice\s*total|invoice\s*value|total\s*amount|net\s*payable|net\s*amount\s*payable|amount\s*due|balance\s*due|total\s*due|amount\s*payable)\s*[:\-]?\s*(?:INR|₹|Rs\.?)?\s*([-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)(?:[.,]\d{1,2})?)/gi
    ).map((value) => {
      const major = parseAmountToken(value);
      if (major === null || major <= 0) return "";
      return String(Math.round(major * 100));
    })
  ]);

  const candidateMap: Record<string, string[]> = {
    invoiceNumber: invoiceNumberMatches,
    vendorName: vendorMatches,
    currency: currencyMatches,
    totalAmountMinor: totalMatches
  };

  const currentValues: Record<string, string | undefined> = {
    invoiceNumber: parsed.invoiceNumber,
    vendorName: parsed.vendorName,
    currency: parsed.currency,
    totalAmountMinor: parsed.totalAmountMinor !== undefined ? String(parsed.totalAmountMinor) : undefined
  };

  const filtered = Object.fromEntries(
    Object.entries(candidateMap).filter(([field, values]) => values.length > 1 || !currentValues[field])
  );
  return filtered as Record<string, string[]>;
}

export function buildFieldRegions(
  blocks: OcrBlock[],
  fieldCandidates: Record<string, string[]>
): Record<string, OcrBlock[]> {
  if (blocks.length === 0) {
    return {};
  }

  const regions: Record<string, OcrBlock[]> = {};
  for (const [field, candidates] of Object.entries(fieldCandidates)) {
    const terms = candidates.flatMap((candidate) => candidateTerms(field, candidate));
    if (terms.length === 0) {
      continue;
    }

    const matches = blocks.filter((block) => {
      const haystack = block.text.trim().toLowerCase();
      if (!haystack) {
        return false;
      }
      return terms.some((term) => term.length > 0 && haystack.includes(term));
    });

    if (matches.length > 0) {
      regions[field] = matches.slice(0, 20);
    }
  }

  return regions;
}

function candidateTerms(field: string, value: string): string[] {
  const base = value.trim().toLowerCase();
  if (!base) {
    return [];
  }

  if ((field === "invoiceDate" || field === "dueDate") && /^\d{4}-\d{2}-\d{2}$/.test(base)) {
    const d = new Date(base);
    return isNaN(d.getTime()) ? [base] : buildDateTerms(d);
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

function collectMatches(text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? match[0];
    if (value && value.trim().length > 0) {
      matches.push(value.trim());
    }
  }
  return matches;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}
