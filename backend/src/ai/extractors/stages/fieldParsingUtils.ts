import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import { currencyBySymbol } from "@/ai/parsers/invoiceParser.js";
import { normalizeDate } from "@/ai/parsers/dateParser.js";
import { clampProbability } from "@/utils/math.js";
import { uniqueStrings } from "@/utils/text.js";

export { clampProbability } from "@/utils/math.js";

export function resolveMonthNumber(value: string): string | undefined {
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

export function normalizeDateToken(text: string): Date | undefined {
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
    const result = normalizeDate(match[1]);
    if (result) {
      return result;
    }
  }
  return undefined;
}

export function detectExplicitCurrency(text: string, ocrBlocks: OcrBlock[] = []): string | undefined {
  const hasIndiaTaxContext = /\b(place of supply|gstin|cgst|sgst|igst|gst|tax invoice)\b/i.test(text) ||
    /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]\b/i.test(text) ||
    ocrBlocks.some((block) => /\b(gstin|cgst|sgst|igst|gst|place of supply)\b/i.test(block.text));
  const hasUsdContext = /\bUSD\b/i.test(text) || ocrBlocks.some((block) => /\bUSD\b/i.test(block.text));
  if (hasUsdContext) {
    return "USD";
  }
  if (/\$/.test(text) && !hasIndiaTaxContext) {
    return "USD";
  }
  if (/\bINR\b/i.test(text) || /₹/.test(text)) {
    return "INR";
  }
  if (hasIndiaTaxContext) {
    return "INR";
  }
  if (ocrBlocks.some((block) => /\$/.test(block.text) && !hasIndiaTaxContext)) {
    return "USD";
  }
  const symbolMatch = text.match(/([$€£₹])/);
  if (symbolMatch) {
    return currencyBySymbol[symbolMatch[1]];
  }
  return undefined;
}

export function uniqueIssues(issues: string[]): string[] {
  return uniqueStrings(issues);
}

export function formatConfidence(value: number): string {
  return clampProbability(value).toFixed(4);
}

export function candidateTerms(field: string, value: string): string[] {
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

function buildDateTerms(value: Date): string[] {
  const iso = value.toISOString().slice(0, 10);
  const [year, month, day] = iso.split("-");
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isInteger(dayNumber)) {
    return [iso];
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
  return [iso, `${longMonth} ${normalizedDay}, ${year}`, `${shortMonth} ${normalizedDay}, ${year}`].filter(Boolean);
}
