import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { ConfidenceTone } from "@/types/confidence.js";
import { clamp, normalizeConfidence } from "@/utils/math.js";

const DEFAULT_AUTO_SELECT_MIN = 91;
const DEFAULT_OCR_WEIGHT = 0.65;
const DEFAULT_COMPLETENESS_WEIGHT = 0.35;
const DEFAULT_WARNING_PENALTY = 4;
const DEFAULT_WARNING_PENALTY_CAP = 25;

const DEFAULT_REQUIRED_FIELDS: Array<keyof ParsedInvoiceData> = [
  "invoiceNumber",
  "vendorName",
  "invoiceDate",
  "totalAmountMinor",
  "currency"
];

export interface ConfidenceTenantConfig {
  ocrWeight?: number;
  completenessWeight?: number;
  warningPenalty?: number;
  warningPenaltyCap?: number;
  requiredFields?: string[];
}

interface ConfidenceInput {
  ocrConfidence?: number;
  parsed: ParsedInvoiceData;
  warnings: string[];
  autoSelectMin?: number;
  complianceRiskPenalty?: number;
  autoApprovalThreshold?: number;
  tenantConfig?: ConfidenceTenantConfig;
}

export interface ConfidenceAssessment {
  score: number;
  tone: ConfidenceTone;
  autoSelectForApproval: boolean;
}

export function assessInvoiceConfidence(input: ConfidenceInput): ConfidenceAssessment {
  const normalizedOcr = input.ocrConfidence !== undefined && !Number.isNaN(input.ocrConfidence)
    ? normalizeConfidence(input.ocrConfidence)
    : 0.6;
  const ocrScore = normalizedOcr * 100;

  const tc = input.tenantConfig;
  const ocrWeight = tc?.ocrWeight ?? DEFAULT_OCR_WEIGHT;
  const completenessWeight = tc?.completenessWeight ?? DEFAULT_COMPLETENESS_WEIGHT;
  const warnPenalty = tc?.warningPenalty ?? DEFAULT_WARNING_PENALTY;
  const warnCap = tc?.warningPenaltyCap ?? DEFAULT_WARNING_PENALTY_CAP;
  const reqFields = tc?.requiredFields
    ? tc.requiredFields as Array<keyof ParsedInvoiceData>
    : DEFAULT_REQUIRED_FIELDS;

  const completenessScore = scoreCompleteness(input.parsed, reqFields);

  const warningsPenalty = Math.min(warnCap, input.warnings.length * warnPenalty);
  const compliancePenalty = input.complianceRiskPenalty ?? 0;

  const rawScore = ocrScore * ocrWeight + completenessScore * completenessWeight - warningsPenalty - compliancePenalty;
  const score = clamp(Number.isFinite(rawScore) ? Math.round(rawScore) : 0, 0, 100);

  const greenThreshold = input.autoApprovalThreshold ?? DEFAULT_AUTO_SELECT_MIN;
  const tone = getConfidenceTone(score, greenThreshold);

  return {
    score,
    tone,
    autoSelectForApproval: score >= (input.autoSelectMin ?? DEFAULT_AUTO_SELECT_MIN),
  };
}

export function getConfidenceTone(score: number, greenThreshold = DEFAULT_AUTO_SELECT_MIN): ConfidenceTone {
  if (score >= greenThreshold) {
    return "green";
  }

  const yellowThreshold = Math.max(0, greenThreshold - 11);
  if (score >= yellowThreshold) {
    return "yellow";
  }

  return "red";
}

function scoreCompleteness(parsed: ParsedInvoiceData, requiredFields: Array<keyof ParsedInvoiceData> = DEFAULT_REQUIRED_FIELDS): number {
  if (requiredFields.length === 0) return 100;
  let present = 0;
  for (const field of requiredFields) {
    const value = parsed[field];
    if (value !== undefined && value !== null && value !== "") {
      present += 1;
    }
  }

  return Math.round((present / requiredFields.length) * 100);
}
