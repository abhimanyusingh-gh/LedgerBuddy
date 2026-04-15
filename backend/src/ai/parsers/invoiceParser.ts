import type { ParsedInvoiceData } from "@/types/invoice.js";
import { toMinorUnits } from "@/utils/currency.js";
import { extractTotalAmount, parseAmountToken } from "@/ai/parsers/amountParser.js";
import { normalizeDate, shouldPreferDayFirstDates } from "@/ai/parsers/dateParser.js";
import { extractCurrency, currencyBySymbol } from "@/ai/parsers/currencyParser.js";
import { resolveVendorName, buildExplicitVendorLinePattern, VENDOR_ADDRESS_SIGNAL_PATTERN, VENDOR_NON_VENDOR_SIGNAL_PATTERN } from "@/ai/parsers/vendorParser.js";
export { extractTotalAmount, parseAmountToken, parseAmountTokenWithOcrRepair } from "@/ai/parsers/amountParser.js";
export { currencyBySymbol } from "@/ai/parsers/currencyParser.js";

interface ParseResult {
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
      /(?:date\s*d['']échéance|[ée]ch[ée]ance)\s*[:\-]?\s*([0-3]?\d[\/.\-][01]?\d[\/.\-](?:\d{4}|\d{2}))/i,
      /(?:date\s*d['']échéance|[ée]ch[ée]ance)\s*[:\-]?\s*([A-Za-zÀ-ÿ]{3,14}\s+[0-3]?\d,?\s+\d{4})/i
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
  /(?:pro(?:forma|perma)?|performa)\s+invoice\s*(?:number|no\.?|#)?\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/i,
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
const invoiceNumberIrnPattern = /^[0-9a-f]{64}$/i;
const invoiceNumberAckNoPattern = /^\d{15,}$/;

const weakTotalPattern = /\b(total|payable|balance|amount\s*due|amt\s*due|amount)\b/i;
const strongTotalPattern =
  /(grand\s*total|amount\s*payable|amount\s*due|total\s*due|invoice\s*total|invoice\s*value|total\s*amount|net\s*payable|net\s*amount\s*payable|total\s*payable|amt\s*due|betrag)/i;

const datePatterns = [
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date\s*of\s*issue|issue\s*date)\s*[:\-]?\s*([0-3]?\d[\/.-][01]?\d[\/.-](?:\d{4}|\d{2}))/i,
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date\s*of\s*issue|issue\s*date)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4})/i,
  /(?:invoice\s*date|bill\s*date|bill\s*dt\.?|date\s*of\s*issue|issue\s*date)\s*[:\-]?\s*(\d{4}[\/.-]\d{2})/i,
  /(?<!ack[.\s]*)(?<!acknowledgment[.\s]*)(?<!irn[.\s]*)(?<!e-?invoice[.\s]*)(?:date|dt\.?|do[.•]?)\s*[:\-]?\s*([0-3]?\d[\/.-][01]?\d[\/.-](?:\d{4}|\d{2}))/i,
  /(?<!ack[.\s]*)(?<!acknowledgment[.\s]*)(?<!irn[.\s]*)(?<!e-?invoice[.\s]*)(?:date|dt\.?|do[.•]?)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4})/i
];

const dueDatePatterns = [
  /(?:due\s*date|payment\s*due)\s*[:\-]?\s*([0-3]?\d[\/.-][01]?\d[\/.-](?:\d{4}|\d{2}))/i,
  /(?:due\s*date|payment\s*due)\s*[:\-]?\s*([A-Za-z]{3,9}\s+[0-3]?\d,?\s+\d{4})/i
];

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
  const languagePrefixes = languageHint ? LANGUAGE_PATTERN_OVERRIDES[languageHint]?.vendorPrefixes ?? [] : [];
  const explicitVendorLinePattern = buildExplicitVendorLinePattern(languageHint, languagePrefixes);
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
  invoiceDate?: Date;
  dueDate?: Date;
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
    ? normalizeDate(invoiceDateRaw, { preferDayFirst: options.preferDayFirstDates })
    : undefined;

  const dueDateRaw = findFirstMatch(text, options.dueDatePatterns);
  const dueDate = dueDateRaw
    ? normalizeDate(dueDateRaw, { preferDayFirst: options.preferDayFirstDates })
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

function findFirstMatch(text: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function isLikelyInvoiceNumber(value: string): boolean {
  const normalized = value.trim();
  if (normalized.length < 3 || invoiceNumberBlockedValuePattern.test(normalized)) {
    return false;
  }

  if (invoiceNumberIrnPattern.test(normalized) || invoiceNumberAckNoPattern.test(normalized)) {
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
      const recovered = normalizeDate(dateMatch[1], { preferDayFirst });
      if (recovered) {
        parsed.invoiceDate = recovered;
        warnings.push("Invoice date found via last-resort extraction.");
      }
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
      if (clean.length >= 4 && clean.length <= 60 && !VENDOR_NON_VENDOR_SIGNAL_PATTERN.test(clean) && !VENDOR_ADDRESS_SIGNAL_PATTERN.test(clean)) {
        parsed.vendorName = clean;
        warnings.push("Vendor name found via last-resort extraction.");
        break;
      }
    }
  }
}
