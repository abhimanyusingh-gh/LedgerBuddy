import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { ConfidenceTone } from "@/types/confidence.js";
import { clamp, normalizeConfidence } from "@/utils/math.js";

const DEFAULT_AUTO_SELECT_MIN = 91;

interface ConfidenceInput {
  ocrConfidence?: number;
  parsed: ParsedInvoiceData;
  warnings: string[];
  autoSelectMin?: number;
  complianceRiskPenalty?: number;
}

export interface ConfidenceAssessment {
  score: number;
  tone: ConfidenceTone;
  autoSelectForApproval: boolean;
}

const REQUIRED_FIELDS: Array<keyof ParsedInvoiceData> = [
  "invoiceNumber",
  "vendorName",
  "invoiceDate",
  "totalAmountMinor",
  "currency"
];

export function assessInvoiceConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const normalizedOcr = input.ocrConfidence !== undefined && !Number.isNaN(input.ocrConfidence)
    ? normalizeConfidence(input.ocrConfidence)
    : 0.6;
  const ocrScore = normalizedOcr * 100;
  const completenessScore = scoreCompleteness(input.parsed);

  const warningsPenalty = Math.min(25, input.warnings.length * 4);
  const compliancePenalty = input.complianceRiskPenalty ?? 0;

  const score = clamp(
    Math.round(ocrScore * 0.65 + completenessScore * 0.35 - warningsPenalty - compliancePenalty),
    0,
    100
  );

  const tone = getConfidenceTone(score);

  return {
    score,
    tone,
    autoSelectForApproval: score >= (input.autoSelectMin ?? DEFAULT_AUTO_SELECT_MIN),
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
