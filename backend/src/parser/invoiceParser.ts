import type { ParsedInvoiceData } from "../types/invoice.js";
import { toMinorUnits } from "../utils/currency.js";

export interface ParseResult {
  parsed: ParsedInvoiceData;
  warnings: string[];
}

interface ParseInvoiceOptions {
  languageHint?: string;
}

const LANGUAGE_PATTERN_OVERRIDES: Record<string, {
  invoiceNumber: RegExp[];
  invoiceDate: RegExp[];
  dueDate: RegExp[];
  vendorPrefixes: string[];
}> = {
  fr: {
    invoiceNumber: [
      /(?:num[ée]ro|n[°o]|nº)\s*de\s*facture\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:date\s*de\s*facture)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i,
      /(?:date\s*de\s*facture)\s*[:\-]?\s*([A-Za-zÀ-ÿ]{3,14}\s+[0-3]?\d,?\s+\d{4})/i
    ],
    dueDate: [
      /(?:date\s*d['’]échéance|[ée]ch[ée]ance)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i,
      /(?:date\s*d['’]échéance|[ée]ch[ée]ance)\s*[:\-]?\s*([A-Za-zÀ-ÿ]{3,14}\s+[0-3]?\d,?\s+\d{4})/i
    ],
    vendorPrefixes: ["fournisseur", "vendeur", "soci[ée]t[ée]"]
  },
  de: {
    invoiceNumber: [
      /(?:rechnungsnummer|rechnung\s*nr\.?)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:rechnungsdatum|datum)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    dueDate: [
      /(?:f[äa]llig(?:keit|keitsdatum)|zahlbar\s*bis)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    vendorPrefixes: ["lieferant", "anbieter", "firma"]
  },
  nl: {
    invoiceNumber: [
      /(?:factuurnummer|factuur\s*nr\.?)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:factuurdatum|datum)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    dueDate: [
      /(?:vervaldatum|te\s*betalen\s*voor)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    vendorPrefixes: ["leverancier", "verkoper", "bedrijf"]
  },
  es: {
    invoiceNumber: [
      /(?:n[uú]mero\s*de\s*factura|factura\s*n[oº]\.?)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:fecha\s*de\s*factura|fecha)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    dueDate: [
      /(?:fecha\s*de\s*vencimiento|vencimiento)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    vendorPrefixes: ["proveedor", "empresa", "vendedor"]
  },
  it: {
    invoiceNumber: [
      /(?:numero\s*fattura|fattura\s*n[oº]\.?)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:data\s*fattura|data)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    dueDate: [
      /(?:scadenza|data\s*di\s*scadenza)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    vendorPrefixes: ["fornitore", "azienda", "venditore"]
  },
  hi: {
    invoiceNumber: [
      /(?:बिल\s*(?:संख्या|नं\.?|क्र\.?)|चालान\s*(?:संख्या|नं\.?|क्र\.?))\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
    ],
    invoiceDate: [
      /(?:बिल\s*(?:की\s*)?(?:तारीख|दिनांक)|चालान\s*(?:की\s*)?(?:तारीख|दिनांक)|दिनांक)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    dueDate: [
      /(?:देय\s*(?:तारीख|दिनांक)|भुगतान\s*(?:की\s*)?(?:अंतिम\s*)?(?:तारीख|दिनांक))\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i
    ],
    vendorPrefixes: ["विक्रेता", "कंपनी", "फर्म", "आपूर्तिकर्ता"]
  }
};

const invoiceNumberPatterns = [
  /invoice\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /invoice\s*(?:n[o°]\.?|nr)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /bill\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /inv(?:oice)?\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /(?:invoice|factuur|facture)\s*(?:number|nummer|no\.?|#|n[°o])\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /n[°o]\s*de\s*facture\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /receipt\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
  /challan\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i
];

const invoiceNumberHintPattern =
  /\b(invoice|facture|factuur|bill|receipt|challan|inv(?:oice)?|n[°o]\s*de\s*facture)\b.*\b(no\.?|number|#|n[°o]|nummer)?\b/i;
const invoiceNumberTokenPattern = /([A-Z0-9][A-Z0-9_\-/]{2,})/;
const invoiceNumberBlockedValuePattern = /^(invoice|number|page|aws)$/i;

const baseVendorPrefixes = ["vendor", "supplier", "sold\\s*by", "bill\\s*from", "from", "company", "merchant", "hotel\\s*details"];
const vendorRefinementPattern = /^(?:vendor|supplier|sold\s*by|bill\s*from|from|company|merchant|fournisseur|vendeur|soci[ée]t[ée]|lieferant|anbieter|firma|leverancier|verkoper|bedrijf|proveedor|empresa|vendedor|fornitore|azienda|venditore)\s*[:\-]?\s*/i;
const legalEntityPattern =
  /\b(ltd|limited|pvt|private|llc|inc|corp|corporation|gmbh|s\.?a\.?r\.?l\.?|plc|pte|company|co\.?)\b/i;
const genericVendorStopPattern =
  /\b(facture|factuur|invoice|receipt|payment|statement|description|charges|summary|account|customer|memo|quotation|bill)\b/i;
const blockedVendorPrefixPattern =
  /^(guest\s*name|billing\s*address|shipping\s*address|warehouse\s*address|order\s*id|order\s*date|booking\s*id|payment\s*mode|invoice\s*date|due\s*date|date)\b/i;
const addressSignalPattern =
  /\b(address|warehouse|village|road|street|st\.|avenue|ave\.|taluk|district|state|country|india|karnataka|hobli|zip|zipcode|postal|pin|near)\b/i;
const nonVendorSignalPattern =
  /\b(invoice|bill|date|total|tax|amount|qty|quantity|gst|vat|phone|email|mobile|bank|ifsc|swift|branch|guest|customer|booking|description|payment|receipt)\b/i;

const currencyPatterns = [
  /\b(USD|EUR|GBP|INR|AUD|CAD|JPY|AED|SGD|CHF|CNY)\b/i,
  /([$€£₹])/g
];
export const currencyBySymbol: Record<string, string> = {
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "₹": "INR"
};

const datePatterns = [
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date|dt\.?|do[.•]?)\s*[:\-]?\s*([0-3]?\d[\/.-][01]?\d[\/.-](?:\d{4}|\d{2}))/i,
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date|dt\.?|do[.•]?)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4})/i,
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date|dt\.?|do[.•]?)\s*[:\-]?\s*(\d{4}[\/.-]\d{2})/i
];

const dueDatePatterns = [
  /(?:due\s*date|payment\s*due)\s*[:\-]?\s*([0-3]?\d[\/.-][01]?\d[\/.-](?:\d{4}|\d{2}))/i,
  /(?:due\s*date|payment\s*due)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4})/i
];

const strongTotalPattern =
  /(grand\s*total|amount\s*payable|amount\s*due|total\s*due|invoice\s*total|net\s*payable|total\s*payable|amt\s*due|betrag)/i;
const weakTotalPattern = /\b(total|payable|balance|amount\s*due|amt\s*due|amount)\b/i;
const negativeTotalPattern =
  /(sub\s*total|subtotal|balance\s*due|tax(?:able)?|vat|gst|cgst|sgst|igst|mwst|u\s*st|ust|discount|round(?:ing)?\s*off|shipping|freight|delivery|paid|payment\s*received|advance|credit\s*note)/i;
const amountTokenPattern = /[-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)(?:[.,]\d{1,2})?/g;

export function parseInvoiceText(text: string, options?: ParseInvoiceOptions): ParseResult {
  const warnings: string[] = [];
  const parsed: ParsedInvoiceData = {
    notes: []
  };
  const languageHint = normalizeLanguageHint(options?.languageHint);

  const compactText = normalizeForParsing(text);
  const resolvedInvoiceNumberPatterns = resolvePatternSet("invoiceNumber", languageHint, invoiceNumberPatterns);
  const resolvedDatePatterns = resolvePatternSet("invoiceDate", languageHint, datePatterns);
  const resolvedDueDatePatterns = resolvePatternSet("dueDate", languageHint, dueDatePatterns);
  const explicitVendorLinePattern = buildExplicitVendorLinePattern(languageHint);
  const preferDayFirstDates = shouldPreferDayFirstDates(languageHint);

  const headerFields = extractHeaderFields(compactText, {
    invoiceNumberPatterns: resolvedInvoiceNumberPatterns,
    invoiceDatePatterns: resolvedDatePatterns,
    dueDatePatterns: resolvedDueDatePatterns,
    explicitVendorLinePattern,
    preferDayFirstDates
  });
  parsed.invoiceNumber = headerFields.invoiceNumber;
  parsed.vendorName = headerFields.vendorName;
  parsed.currency = headerFields.currency;
  parsed.invoiceDate = headerFields.invoiceDate;
  parsed.dueDate = headerFields.dueDate;
  if (headerFields.warnings.length > 0) {
    warnings.push(...headerFields.warnings);
  }

  const totalAmount = extractTotalAmount(compactText);
  if (totalAmount === undefined) {
    warnings.push("Could not confidently detect total amount.");
  } else {
    parsed.totalAmountMinor = toMinorUnits(totalAmount, parsed.currency);
  }

  const hasNoFields = !parsed.invoiceNumber && !parsed.vendorName && parsed.totalAmountMinor === undefined && !parsed.invoiceDate;
  if (hasNoFields && compactText.trim().length > 20) {
    applyLastResortExtraction(compactText, parsed, warnings, preferDayFirstDates);
  }

  return {
    parsed,
    warnings
  };
}

export function extractTotalAmount(text: string): number | undefined {
  const lines = splitParsedLines(text);
  if (lines.length === 0) {
    return undefined;
  }

  const labeledCandidates = collectLabeledAmountCandidates(lines);
  if (labeledCandidates.length > 0) {
    return pickBestAmountCandidate(labeledCandidates)?.amount;
  }

  return pickBestFallbackAmount(lines);
}

function extractInvoiceNumber(text: string, patterns: RegExp[]): string | undefined {
  const direct = findFirstMatch(text, patterns);
  if (direct && isLikelyInvoiceNumber(direct)) {
    return direct;
  }

  const lines = splitParsedLines(text);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!invoiceNumberHintPattern.test(line)) {
      continue;
    }

    const inlineValue = line
      .replace(/invoice|facture|factuur|bill|n[°o]\s*de\s*facture/gi, " ")
      .match(invoiceNumberTokenPattern)?.[1];
    if (inlineValue && isLikelyInvoiceNumber(inlineValue)) {
      return inlineValue;
    }

    const nextLine = lines[index + 1];
    if (!nextLine) {
      continue;
    }

    const nextValue = nextLine.match(invoiceNumberTokenPattern)?.[1];
    if (nextValue && isLikelyInvoiceNumber(nextValue)) {
      return nextValue;
    }
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\s*no\.?\s*[:\-]?\s*$/i.test(line) && !/^\s*no\.?\s*[:\-]/i.test(line)) {
      continue;
    }

    const inlineValue = line.replace(/^\s*no\.?\s*[:\-]?\s*/i, "").match(invoiceNumberTokenPattern)?.[1];
    if (inlineValue && isLikelyInvoiceNumber(inlineValue)) {
      return inlineValue;
    }

    if (index > 0) {
      const prevLine = lines[index - 1];
      if (/\bdate\b/i.test(prevLine) && index > 1) {
        const prevPrevValue = lines[index - 2].match(invoiceNumberTokenPattern)?.[1];
        if (prevPrevValue && isLikelyInvoiceNumber(prevPrevValue)) {
          return prevPrevValue;
        }
      } else if (!/\bdate\b/i.test(prevLine)) {
        const prevValue = prevLine.match(invoiceNumberTokenPattern)?.[1];
        if (prevValue && isLikelyInvoiceNumber(prevValue)) {
          return prevValue;
        }
      }
    }

    const nextLine = lines[index + 1];
    if (nextLine && !weakTotalPattern.test(nextLine) && !strongTotalPattern.test(nextLine)) {
      const nextVal = nextLine.match(invoiceNumberTokenPattern)?.[1];
      if (nextVal && isLikelyInvoiceNumber(nextVal)) {
        return nextVal;
      }
    }
  }

  return undefined;
}

function extractHeaderFields(
  text: string,
  options: {
    invoiceNumberPatterns: RegExp[];
    invoiceDatePatterns: RegExp[];
    dueDatePatterns: RegExp[];
    explicitVendorLinePattern: RegExp;
    preferDayFirstDates: boolean;
  }
): {
  invoiceNumber?: string;
  vendorName?: string;
  currency: string;
  invoiceDate?: string;
  dueDate?: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  const invoiceNumber = extractInvoiceNumber(text, options.invoiceNumberPatterns);
  if (!invoiceNumber) {
    warnings.push("Could not confidently detect invoice number.");
  }

  const vendorName = resolveVendorName(text, options.explicitVendorLinePattern);
  if (!vendorName) {
    warnings.push("Could not confidently detect vendor name.");
  }

  const detectedCurrency = extractCurrency(text);
  const currency = detectedCurrency ?? "INR";
  if (!detectedCurrency) {
    warnings.push("Could not confidently detect currency; defaulting to INR.");
  }

  const invoiceDateRaw = findFirstMatch(text, options.invoiceDatePatterns);
  const invoiceDate = invoiceDateRaw
    ? normalizeDate(invoiceDateRaw, { preferDayFirst: options.preferDayFirstDates }) ?? invoiceDateRaw
    : undefined;

  const dueDateRaw = findFirstMatch(text, options.dueDatePatterns);
  const dueDate = dueDateRaw
    ? normalizeDate(dueDateRaw, { preferDayFirst: options.preferDayFirstDates }) ?? dueDateRaw
    : undefined;

  return {
    invoiceNumber,
    vendorName,
    currency,
    invoiceDate,
    dueDate,
    warnings
  };
}

function splitParsedLines(text: string): string[] {
  return text
    .replace(/\r/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectLabeledAmountCandidates(lines: string[]): AmountCandidate[] {
  const candidates: AmountCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    if (!strongTotalPattern.test(line) && !weakTotalPattern.test(line)) {
      continue;
    }

    const values = extractValuesNearLabeledTotal(lines, index);
    if (values.length === 0) {
      continue;
    }

    const baseScore = scoreLineForLabeledAmount(line, index, lines.length);
    if (baseScore <= 0) {
      continue;
    }

    for (const value of values) {
      candidates.push({
        amount: value,
        score: baseScore + scoreAmountMagnitude(value),
        lineIndex: index
      });
    }
  }

  return candidates;
}

function extractValuesNearLabeledTotal(lines: string[], lineIndex: number): number[] {
  const directValues = extractAmountValuesFromLine(lines[lineIndex]);
  if (directValues.length > 0) {
    return directValues;
  }

  const collected: number[] = [];
  for (let offset = 1; offset <= 3; offset += 1) {
    const nextLine = lines[lineIndex + offset];
    if (!nextLine) {
      break;
    }
    if (offset > 1 && /[A-Za-z]/.test(nextLine) && extractAmountValuesFromLine(nextLine).length === 0) {
      break;
    }
    collected.push(...extractAmountValuesFromLine(nextLine));
  }
  return collected;
}

function pickBestFallbackAmount(lines: string[]): number | undefined {
  const candidates: AmountCandidate[] = [];

  for (const [index, line] of lines.entries()) {
    if (negativeTotalPattern.test(line)) {
      continue;
    }

    const values = extractAmountValuesFromLine(line);
    if (values.length === 0) {
      continue;
    }

    if (!weakTotalPattern.test(line) && !hasMonetaryContext(line, values)) {
      continue;
    }

    const positionBonus = index >= Math.floor(lines.length * 0.6) ? 8 : 0;
    for (const value of values) {
      candidates.push({
        amount: value,
        score: positionBonus + scoreAmountMagnitude(value),
        lineIndex: index
      });
    }
  }

  return pickBestAmountCandidate(candidates)?.amount;
}

function normalizeForParsing(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\[\s*page\s+\d+\s*\]/gi, "\n")
    .replace(/<\|ref\|>.*?<\|\/ref\|>/g, " ")
    .replace(/<\|det\|>.*?<\|\/det\|>/g, "\n")
    .replace(/<\/?(table|thead|tbody|tr)>/gi, "\n")
    .replace(/<\/?td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\*\*/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

function normalizeLanguageHint(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return normalized.split(/[_-]/, 1)[0];
}

function resolvePatternSet(
  type: "invoiceNumber" | "invoiceDate" | "dueDate",
  languageHint: string | undefined,
  fallback: RegExp[]
): RegExp[] {
  if (!languageHint) {
    return fallback;
  }

  const languageConfig = LANGUAGE_PATTERN_OVERRIDES[languageHint];
  if (!languageConfig) {
    return fallback;
  }

  const override =
    type === "invoiceNumber"
      ? languageConfig.invoiceNumber
      : type === "invoiceDate"
        ? languageConfig.invoiceDate
        : languageConfig.dueDate;
  return [...override, ...fallback];
}

function buildExplicitVendorLinePattern(languageHint: string | undefined): RegExp {
  const languagePrefixes = languageHint ? LANGUAGE_PATTERN_OVERRIDES[languageHint]?.vendorPrefixes ?? [] : [];
  const prefixes = [...new Set([...baseVendorPrefixes, ...languagePrefixes])];
  const pattern = prefixes.join("|");
  return new RegExp(`^(${pattern})\\s*[:\\-]?\\s*(.*)$`, "i");
}

function shouldPreferDayFirstDates(languageHint: string | undefined): boolean {
  if (!languageHint) {
    return false;
  }
  return ["fr", "de", "nl", "es", "it", "pt"].includes(languageHint);
}

function findFirstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function resolveVendorName(text: string, explicitPattern: RegExp): string | undefined {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2);

  const explicit = extractExplicitVendor(lines, explicitPattern);
  if (explicit) {
    return explicit;
  }

  const hotelCandidate = extractHotelVendor(lines);
  if (hotelCandidate) {
    return hotelCandidate;
  }

  return pickLikelyVendorLine(lines);
}

function extractExplicitVendor(lines: string[], explicitPattern: RegExp): string | undefined {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(explicitPattern);
    if (!match) {
      continue;
    }

    const candidate = sanitizeVendorCandidate(match[2], { allowSingleWord: true });
    if (candidate) {
      return candidate;
    }

    const nextLine = lines[index + 1];
    if (!nextLine) {
      continue;
    }

    const nextCandidate = sanitizeVendorCandidate(nextLine, { allowSingleWord: true });
    if (nextCandidate) {
      return nextCandidate;
    }
  }

  return undefined;
}

function extractHotelVendor(lines: string[]): string | undefined {
  for (const line of lines.slice(0, 20)) {
    const match = line.match(/hotel\s*details\s*[:\-]?\s*([A-Za-z0-9&'().\-\s]{2,})/i);
    if (!match?.[1]) {
      continue;
    }

    const normalized = match[1].split(",")[0].trim();
    const brandToken = normalized.match(/([A-Za-z][A-Za-z0-9&'().-]{1,})/)?.[1];
    if (!brandToken) {
      continue;
    }

    const candidate = sanitizeVendorCandidate(brandToken, { allowSingleWord: true });
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

function pickLikelyVendorLine(lines: string[]): string | undefined {
  const scopedLines = lines.slice(0, 18);

  let bestCandidate: { value: string; score: number } | null = null;

  for (const [index, rawLine] of scopedLines.entries()) {
    const candidate = sanitizeVendorCandidate(rawLine, { relaxed: true });
    if (!candidate) {
      continue;
    }

    let score = 0;
    if (index <= 3) {
      score += 28;
    } else if (index <= 8) {
      score += 16;
    } else {
      score += 6;
    }

    if (legalEntityPattern.test(candidate)) {
      score += 20;
    }

    if (/^[A-Z0-9&.,'()/\-\s]+$/.test(candidate)) {
      score += 8;
    }

    const wordCount = candidate.split(/\s+/).length;
    if (wordCount >= 2 && wordCount <= 8) {
      score += 8;
    } else if (wordCount === 1) {
      score -= 10;
    }

    if (candidate.includes(",")) {
      score -= 6;
    }

    const digitCount = (candidate.match(/\d/g) ?? []).length;
    if (digitCount > 4) {
      score -= 20;
    } else if (digitCount > 0) {
      score -= 8;
    }

    if (candidate.length > 72) {
      score -= 14;
    }

    if (genericVendorStopPattern.test(candidate)) {
      score -= 28;
    }

    if (candidate.includes(":")) {
      score -= 20;
    }

    if (bestCandidate === null || score > bestCandidate.score) {
      bestCandidate = { value: candidate, score };
    }
  }

  if (!bestCandidate || bestCandidate.score < 0) {
    return undefined;
  }

  return bestCandidate.value;
}

function sanitizeVendorCandidate(rawValue: string, options?: { allowSingleWord?: boolean; relaxed?: boolean }): string | undefined {
  const normalized = rawValue
    .replace(vendorRefinementPattern, "")
    .replace(/^[^:]+:\s*/g, (prefix) => (blockedVendorPrefixPattern.test(prefix) ? "" : prefix))
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[#*|`]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[^A-Za-z]+/, "")
    .replace(/[,:;.\-–|]+$/, "")
    .trim();

  if (normalized.length < 3) {
    return undefined;
  }

  if (blockedVendorPrefixPattern.test(normalized)) {
    return undefined;
  }

  if (!options?.relaxed) {
    if (addressSignalPattern.test(normalized)) {
      return undefined;
    }

    if (nonVendorSignalPattern.test(normalized)) {
      return undefined;
    }

    if (genericVendorStopPattern.test(normalized) && !legalEntityPattern.test(normalized)) {
      return undefined;
    }
  }

  if (normalized.split(",").length > 3) {
    return undefined;
  }

  if (normalized.length > 80) {
    return undefined;
  }

  if (!options?.allowSingleWord && normalized.split(/\s+/).length === 1 && !legalEntityPattern.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function extractCurrency(text: string): string | undefined {
  const codeMatch = text.match(currencyPatterns[0]);
  if (codeMatch?.[1]) {
    return codeMatch[1].toUpperCase();
  }

  if (/\b(gstin|cgst|sgst|igst)\b/i.test(text)) {
    return "INR";
  }

  if (/\bRs\.?\b/i.test(text)) {
    return "INR";
  }

  const symbolMatch = text.match(currencyPatterns[1]);
  if (!symbolMatch?.[0]) {
    return undefined;
  }

  return currencyBySymbol[symbolMatch[0]];
}

function normalizeDate(input: string, options?: { preferDayFirst?: boolean }): string | undefined {
  const sanitized = input.replace(/,/g, "").trim();
  const namedMonth = sanitized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (namedMonth) {
    const month = monthNumber(namedMonth[1]);
    if (month) {
      return `${namedMonth[3]}-${month}-${namedMonth[2].padStart(2, "0")}`;
    }
  }

  const dayMonthName = sanitized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dayMonthName) {
    const month = monthNumber(dayMonthName[2]);
    if (month) {
      return `${dayMonthName[3]}-${month}-${dayMonthName[1].padStart(2, "0")}`;
    }
  }

  const dayFirst = sanitized.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4}|\d{2})$/);
  if (options?.preferDayFirst && dayFirst) {
    return formatDayFirstDate(dayFirst);
  }

  const concatenated = sanitized.match(/^(\d{2})(\d{2})[\/.\-](\d{2,4})$/);
  if (concatenated) {
    return formatDayFirstDate(concatenated);
  }

  const parsed = new Date(sanitized);
  if (!Number.isNaN(parsed.valueOf())) {
    return parsed.toISOString().slice(0, 10);
  }

  if (!dayFirst) {
    return undefined;
  }
  return formatDayFirstDate(dayFirst);
}

function formatDayFirstDate(dayFirst: RegExpMatchArray): string {
  const day = dayFirst[1].padStart(2, "0");
  const month = dayFirst[2].padStart(2, "0");
  const rawYear = dayFirst[3];
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month}-${day}`;
}

function monthNumber(value: string): string | undefined {
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

interface AmountCandidate {
  amount: number;
  score: number;
  lineIndex: number;
}

function scoreLineForLabeledAmount(line: string, lineIndex: number, totalLines: number): number {
  let score = 0;

  if (strongTotalPattern.test(line)) {
    score += 120;
  } else if (weakTotalPattern.test(line)) {
    score += 55;
  }

  if (negativeTotalPattern.test(line)) {
    score -= 85;
  }

  if (/[€£$₹]|(?:\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b)/i.test(line)) {
    score += 6;
  }

  if (lineIndex >= Math.floor(totalLines * 0.6)) {
    score += 8;
  }

  if (/%/.test(line)) {
    score -= 12;
  }

  return score;
}

function pickBestAmountCandidate(candidates: AmountCandidate[]): AmountCandidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }

  return [...candidates].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    if (right.amount !== left.amount) {
      return right.amount - left.amount;
    }

    return right.lineIndex - left.lineIndex;
  })[0];
}

function extractAmountValuesFromLine(line: string): number[] {
  const normalized = line.replace(/\u00A0/g, " ").replace(/\s+/g, " ");
  const rawTokens = normalized.match(amountTokenPattern) ?? [];
  const tokens = rawTokens.flatMap(splitConcatenatedAmountToken);

  const values = tokens
    .map((token) => parseAmountToken(token))
    .filter((value): value is number => value !== null)
    .filter((value) => value > 0);

  return values;
}

function splitConcatenatedAmountToken(token: string): string[] {
  const compact = token.replace(/\s+/g, "");

  if (/^\d+\.\d{2}(?:\d+\.\d{2})+$/.test(compact)) {
    return compact.match(/\d+\.\d{2}/g) as string[];
  }

  if (/^\d+,\d{2}(?:\d+,\d{2})+$/.test(compact)) {
    return compact.match(/\d+,\d{2}/g) as string[];
  }

  return [token];
}

export function parseAmountToken(token: string): number | null {
  const raw = token.replace(/[^0-9,.\-+]/g, "");
  const sign = raw.startsWith("-") ? -1 : 1;
  if (raw === "" || raw === "-" || raw === "+") {
    return null;
  }
  let working = raw.replace(/^[-+]/, "");

  const commaCount = (working.match(/,/g) ?? []).length;
  const dotCount = (working.match(/\./g) ?? []).length;

  if (commaCount > 0 && dotCount > 0) {
    const lastComma = working.lastIndexOf(",");
    const lastDot = working.lastIndexOf(".");
    if (lastDot > lastComma) {
      working = working.replace(/,/g, "");
    } else {
      working = working.replace(/\./g, "").replace(/,/g, ".");
    }
  } else if (commaCount > 0) {
    const parts = working.split(",");
    const fraction = parts[parts.length - 1];
    if (parts.length > 1 && fraction.length <= 2) {
      working = `${parts.slice(0, -1).join("")}.${fraction}`;
    } else {
      working = parts.join("");
    }
  } else if (dotCount > 1) {
    const parts = working.split(".");
    const fraction = parts[parts.length - 1];
    if (fraction.length <= 2) {
      working = `${parts.slice(0, -1).join("")}.${fraction}`;
    } else {
      working = parts.join("");
    }
  } else if (dotCount === 1) {
    const parts = working.split(".");
    const fraction = parts[1];
    if (fraction.length === 3 && parts[0].length >= 1) {
      working = parts.join("");
    }
  }

  const parsed = Number(working);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Number((sign * parsed).toFixed(2));
}

export function parseAmountTokenWithOcrRepair(token: string): number | null {
  const parsed = parseAmountToken(token);
  if (parsed === null) {
    return null;
  }
  const repaired = recoverOCRLeadingDigitAmount(token, Math.abs(parsed));
  if (repaired === null) {
    return parsed;
  }
  return parsed >= 0 ? repaired : -repaired;
}

function recoverOCRLeadingDigitAmount(token: string, parsedMajor: number): number | null {
  if (!Number.isFinite(parsedMajor) || parsedMajor <= 0 || parsedMajor >= 1_000_000) {
    return null;
  }
  const raw = token.replace(/[^0-9,.\-+]/g, "");
  const fractionPartLength = raw.includes(".") ? raw.split(".").pop()?.length ?? 0 : 0;
  if (fractionPartLength === 0) {
    return null;
  }

  const normalized = Math.abs(parsedMajor).toFixed(2);
  const match = normalized.match(/^(\d+)\.(\d{2})$/);
  if (!match) {
    return null;
  }
  const [, integerPart, fractionPart] = match;
  if (integerPart.length < 5 || integerPart.length > 6 || fractionPart === "00") {
    return null;
  }

  const leadingDigit = integerPart[0];
  if (leadingDigit < "5" || leadingDigit > "9") {
    return null;
  }

  const repairedIntegerPart = integerPart.slice(1);
  if (repairedIntegerPart.length < 3) {
    return null;
  }

  const repairedMajor = Number(`${repairedIntegerPart}.${fractionPart}`);
  if (!Number.isFinite(repairedMajor) || repairedMajor <= 0) {
    return null;
  }

  const ratio = parsedMajor / repairedMajor;
  if (ratio < 5 || ratio > 120) {
    return null;
  }
  if (repairedMajor >= 10000) {
    return null;
  }

  return Number(repairedMajor.toFixed(2));
}

function scoreAmountMagnitude(amount: number): number {
  let score = 0;

  if (!Number.isInteger(amount)) {
    score += 6;
  }

  if (Number.isInteger(amount) && amount >= 1900 && amount <= 2100) {
    score -= 18;
  }

  if (Number.isInteger(amount) && amount >= 100_000) {
    score -= 25;
  }

  if (amount >= 1_000_000) {
    score -= 8;
  }

  if (amount >= 10_000) {
    score += 6;
  } else if (amount >= 100) {
    score += 4;
  } else if (amount >= 1) {
    score += 1;
  } else {
    score -= 5;
  }

  return score;
}

function hasMonetaryContext(line: string, values: number[]): boolean {
  if (/[€£$₹]|(?:\bUSD\b|\bEUR\b|\bGBP\b|\bINR\b|\bAUD\b|\bCAD\b|\bJPY\b|\bAED\b|\bSGD\b|\bCHF\b|\bCNY\b)/i.test(line)) {
    return true;
  }

  if (/[.,]\d{1,2}\b/.test(line)) {
    return true;
  }

  return values.some((value) => !Number.isInteger(value));
}

function isLikelyInvoiceNumber(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 3 || invoiceNumberBlockedValuePattern.test(normalized)) {
    return false;
  }

  if (/[0-9]/.test(normalized) || /[-_/]/.test(normalized)) {
    return true;
  }

  return normalized.length >= 6;
}

function applyLastResortExtraction(
  text: string,
  parsed: ParsedInvoiceData,
  warnings: string[],
  preferDayFirst: boolean
): void {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);

  if (!parsed.invoiceDate) {
    const dateMatch = text.match(/\b(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\b/);
    if (dateMatch) {
      parsed.invoiceDate = normalizeDate(dateMatch[1], { preferDayFirst }) ?? dateMatch[1];
      warnings.push("Invoice date found via last-resort extraction.");
    }
  }

  if (parsed.totalAmountMinor === undefined) {
    const moneyMatch = text.match(/[$€£₹]\s*([\d,.\s]+\.\d{2})\b/) ??
      text.match(/\b([\d,]+\.\d{2})\b/);
    if (moneyMatch) {
      const amount = parseAmountToken(moneyMatch[1]);
      if (amount !== null && amount > 0) {
        parsed.totalAmountMinor = toMinorUnits(amount, parsed.currency);
        warnings.push("Total amount found via last-resort extraction.");
      }
    }
  }

  if (!parsed.currency) {
    const symbolMatch = text.match(/[$€£₹]/);
    if (symbolMatch) {
      parsed.currency = currencyBySymbol[symbolMatch[0]];
    }
  }

  if (!parsed.vendorName) {
    for (const line of lines.slice(0, 8)) {
      const clean = line.replace(/[^\w\s.&]/g, "").trim();
      if (clean.length >= 4 && clean.length <= 60 && !nonVendorSignalPattern.test(clean) && !addressSignalPattern.test(clean)) {
        parsed.vendorName = clean;
        warnings.push("Vendor name found via last-resort extraction.");
        break;
      }
    }
  }
}
