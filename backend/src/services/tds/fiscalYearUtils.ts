export const TDS_QUARTER = {
  Q1: "Q1",
  Q2: "Q2",
  Q3: "Q3",
  Q4: "Q4"
} as const;

export type TdsQuarter = (typeof TDS_QUARTER)[keyof typeof TDS_QUARTER];

const IST_TIME_ZONE = "Asia/Kolkata";

interface IstParts {
  year: number;
  month: number;
  day: number;
}

const ISO_PART_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toIstParts(date: Date): IstParts {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("fiscalYearUtils: invalid Date");
  }
  const parts = ISO_PART_FORMATTER.formatToParts(date);
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") lookup[part.type] = part.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day)
  };
}

function formatFinancialYear(startYear: number): string {
  const endYear = (startYear + 1) % 100;
  const endSuffix = endYear.toString().padStart(2, "0");
  return `${startYear}-${endSuffix}`;
}

export function determineFY(date: Date): string {
  const { year, month } = toIstParts(date);
  const startYear = month >= 4 ? year : year - 1;
  return formatFinancialYear(startYear);
}

export function determineQuarter(date: Date): TdsQuarter {
  const { month } = toIstParts(date);
  if (month >= 4 && month <= 6) return TDS_QUARTER.Q1;
  if (month >= 7 && month <= 9) return TDS_QUARTER.Q2;
  if (month >= 10 && month <= 12) return TDS_QUARTER.Q3;
  return TDS_QUARTER.Q4;
}
