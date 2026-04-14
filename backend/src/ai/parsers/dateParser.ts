import { resolveMonthNumber } from "@/ai/extractors/stages/fieldParsingUtils.js";

export function normalizeDate(input: string, options?: { preferDayFirst?: boolean }): string | undefined {
  const sanitized = input.replace(/,/g, "").trim();
  const namedMonth = sanitized.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (namedMonth) {
    const month = resolveMonthNumber(namedMonth[1]);
    if (month) {
      return `${namedMonth[3]}-${month}-${namedMonth[2].padStart(2, "0")}`;
    }
  }

  const dayMonthName = sanitized.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (dayMonthName) {
    const month = resolveMonthNumber(dayMonthName[2]);
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

export function shouldPreferDayFirstDates(languageHint: string | undefined): boolean {
  if (!languageHint) {
    return false;
  }
  return ["fr", "de", "nl", "es", "it", "pt"].includes(languageHint);
}
