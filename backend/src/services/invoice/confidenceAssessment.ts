import type { ParsedInvoiceData } from "../types/invoice.js";
import type { ConfidenceTone, RiskFlag } from "../types/confidence.js";
import { minorUnitsToMajorString, toMinorUnits } from "../utils/currency.js";

interface ConfidenceInput {
  ocrConfidence?: number;
  parsed: ParsedInvoiceData;
  warnings: string[];
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  autoSelectMin: number;
  referenceDate?: Date;
  complianceRiskPenalty?: number;
}

export interface ConfidenceAssessment {
  score: number;
  tone: ConfidenceTone;
  autoSelectForApproval: boolean;
  riskFlags: RiskFlag[];
  riskMessages: string[];
}

const REQUIRED_FIELDS: Array<keyof ParsedInvoiceData> = [
  "invoiceNumber",
  "vendorName",
  "invoiceDate",
  "totalAmountMinor",
  "currency"
];

export function assessInvoiceConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const normalizedOcr = normalizeConfidence(input.ocrConfidence);
  const ocrScore = normalizedOcr * 100;
  const completenessScore = scoreCompleteness(input.parsed);

  const riskAssessment = assessRiskFlags(input.parsed, input.expectedMaxTotal, input.expectedMaxDueDays, input.referenceDate);
  const warningsPenalty = Math.min(25, input.warnings.length * 4);

  const compliancePenalty = input.complianceRiskPenalty ?? 0;

  const score = clamp(
    Math.round(ocrScore * 0.65 + completenessScore * 0.35 - warningsPenalty - riskAssessment.penalty - compliancePenalty),
    0,
    100
  );

  const tone = getConfidenceTone(score);

  return {
    score,
    tone,
    autoSelectForApproval: score >= input.autoSelectMin,
    riskFlags: riskAssessment.flags,
    riskMessages: riskAssessment.messages
  };
}

export function getConfidenceTone(score: number): ConfidenceTone {
  if (score >= 91) {
    return "green";
  }

  if (score >= 80) {
    return "yellow";
  }

  return "red";
}

function normalizeConfidence(value?: number): number {
  if (value === undefined || Number.isNaN(value)) {
    return 0.6;
  }

  if (value > 1) {
    return clamp(value / 100, 0, 1);
  }

  return clamp(value, 0, 1);
}

function scoreCompleteness(parsed: ParsedInvoiceData): number {
  let present = 0;
  for (const field of REQUIRED_FIELDS) {
    const value = parsed[field];
    if (value !== undefined && value !== null && value !== "") {
      present += 1;
    }
  }

  return Math.round((present / REQUIRED_FIELDS.length) * 100);
}

function assessRiskFlags(
  parsed: ParsedInvoiceData,
  expectedMaxTotal: number,
  expectedMaxDueDays: number,
  referenceDate = new Date()
): {
  flags: RiskFlag[];
  messages: string[];
  penalty: number;
} {
  const flags: RiskFlag[] = [];
  const messages: string[] = [];
  let penalty = 0;

  if (
    parsed.totalAmountMinor !== undefined &&
    Number.isInteger(parsed.totalAmountMinor) &&
    expectedMaxTotal > 0
  ) {
    const expectedMaxTotalMinor = toMinorUnits(expectedMaxTotal, parsed.currency);
    if (expectedMaxTotalMinor > 0 && parsed.totalAmountMinor > expectedMaxTotalMinor) {
      flags.push("TOTAL_AMOUNT_ABOVE_EXPECTED");

      const currencyPrefix = parsed.currency ? `${parsed.currency} ` : "";
      messages.push(
        `Total amount ${currencyPrefix}${minorUnitsToMajorString(parsed.totalAmountMinor, parsed.currency)} exceeds expected max ${currencyPrefix}${minorUnitsToMajorString(expectedMaxTotalMinor, parsed.currency)}.`
      );

      const overRatio = (parsed.totalAmountMinor - expectedMaxTotalMinor) / expectedMaxTotalMinor;
      penalty += Math.min(30, Math.round(15 + overRatio * 25));
    }
  }

  const dueDate = parseDate(parsed.dueDate);
  if (dueDate && expectedMaxDueDays > 0) {
    const daysToDue = daysBetween(referenceDate, dueDate);
    if (daysToDue > expectedMaxDueDays) {
      flags.push("DUE_DATE_TOO_FAR");
      messages.push(`Due date is ${daysToDue} days away, expected max is ${expectedMaxDueDays} days.`);

      penalty += Math.min(20, Math.round(8 + (daysToDue - expectedMaxDueDays) / 4));
    }
  }

  return {
    flags,
    messages,
    penalty
  };
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  return date;
}

function daysBetween(from: Date, to: Date): number {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const start = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const end = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((end - start) / oneDayMs);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
