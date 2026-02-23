import type { ParseResult } from "../parser/invoiceParser.js";
import { parseInvoiceText } from "../parser/invoiceParser.js";
import { assessInvoiceConfidence, type ConfidenceAssessment } from "./confidenceAssessment.js";

export interface ExtractionTextCandidate {
  text: string;
  provider: string;
  confidence?: number;
  source: string;
}

interface ExtractionAgentInput {
  candidates: ExtractionTextCandidate[];
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  autoSelectMin: number;
  referenceDate?: Date;
}

interface ExtractionAgentAttempt {
  candidate: ExpandedExtractionCandidate;
  parseResult: ParseResult;
  confidence: ConfidenceAssessment;
  score: number;
}

interface ExpandedExtractionCandidate extends ExtractionTextCandidate {
  strategy: string;
}

interface ExtractionAgentAttemptSummary {
  provider: string;
  source: string;
  strategy: string;
  score: number;
  confidenceScore: number;
  warningCount: number;
  hasTotalAmountMinor: boolean;
  textLength: number;
}

interface ExtractionAgentResult {
  provider: string;
  text: string;
  confidence?: number;
  source: string;
  strategy: string;
  parseResult: ParseResult;
  confidenceAssessment: ConfidenceAssessment;
  attempts: ExtractionAgentAttemptSummary[];
}

export function runInvoiceExtractionAgent(input: ExtractionAgentInput): ExtractionAgentResult {
  const expandedCandidates = dedupeCandidates(
    input.candidates
      .filter((candidate) => candidate.text.trim().length > 0)
      .flatMap((candidate) => expandCandidate(candidate))
  );

  if (expandedCandidates.length === 0) {
    throw new Error("No OCR text candidates are available for extraction.");
  }

  const attempts = expandedCandidates.map((candidate) => {
    const parseResult = parseInvoiceText(candidate.text);
    const confidence = assessInvoiceConfidence({
      ocrConfidence: candidate.confidence,
      parsed: parseResult.parsed,
      warnings: parseResult.warnings,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      autoSelectMin: input.autoSelectMin,
      referenceDate: input.referenceDate
    });

    return {
      candidate,
      parseResult,
      confidence,
      score: scoreCandidate(candidate.text, parseResult, confidence)
    };
  });

  attempts.sort(compareAttempts);
  const best = attempts[0];

  return {
    provider: best.candidate.provider,
    text: best.candidate.text,
    confidence: best.candidate.confidence,
    source: best.candidate.source,
    strategy: best.candidate.strategy,
    parseResult: best.parseResult,
    confidenceAssessment: best.confidence,
    attempts: attempts.map((attempt) => ({
      provider: attempt.candidate.provider,
      source: attempt.candidate.source,
      strategy: attempt.candidate.strategy,
      score: attempt.score,
      confidenceScore: attempt.confidence.score,
      warningCount: attempt.parseResult.warnings.length,
      hasTotalAmountMinor: attempt.parseResult.parsed.totalAmountMinor !== undefined,
      textLength: attempt.candidate.text.length
    }))
  };
}

function compareAttempts(left: ExtractionAgentAttempt, right: ExtractionAgentAttempt): number {
  if (right.score !== left.score) {
    return right.score - left.score;
  }

  if (right.confidence.score !== left.confidence.score) {
    return right.confidence.score - left.confidence.score;
  }

  const leftHasTotal = left.parseResult.parsed.totalAmountMinor !== undefined;
  const rightHasTotal = right.parseResult.parsed.totalAmountMinor !== undefined;
  if (leftHasTotal !== rightHasTotal) {
    return rightHasTotal ? 1 : -1;
  }

  if (left.parseResult.warnings.length !== right.parseResult.warnings.length) {
    return left.parseResult.warnings.length - right.parseResult.warnings.length;
  }

  return right.candidate.text.length - left.candidate.text.length;
}

function scoreCandidate(text: string, parseResult: ParseResult, confidence: ConfidenceAssessment): number {
  let score = confidence.score;

  if (parseResult.parsed.totalAmountMinor !== undefined) {
    score += 24;
  } else {
    score -= 18;
  }

  if (parseResult.parsed.invoiceNumber) {
    score += 8;
  }

  if (parseResult.parsed.vendorName) {
    score += 6;
  }

  if (parseResult.parsed.currency) {
    score += 4;
  }

  if (parseResult.parsed.invoiceDate) {
    score += 4;
  }

  if (parseResult.warnings.length === 0) {
    score += 4;
  } else {
    score -= Math.min(18, parseResult.warnings.length * 2);
  }

  if (text.trim().length < 80) {
    score -= 6;
  }

  return score;
}

function expandCandidate(candidate: ExtractionTextCandidate): ExpandedExtractionCandidate[] {
  const rawText = normalizeLineEndings(candidate.text);
  const groundingText = extractGroundingPayload(rawText);

  const variants: ExpandedExtractionCandidate[] = [
    {
      ...candidate,
      text: rawText,
      strategy: "raw"
    }
  ];

  if (groundingText && groundingText !== rawText) {
    variants.push({
      ...candidate,
      text: groundingText,
      strategy: "grounding-text"
    });
  }

  return variants;
}

function dedupeCandidates(candidates: ExpandedExtractionCandidate[]): ExpandedExtractionCandidate[] {
  const seen = new Set<string>();
  const deduped: ExpandedExtractionCandidate[] = [];

  for (const candidate of candidates) {
    const key = `${candidate.provider}|${candidate.source}|${candidate.text}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
}

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function extractGroundingPayload(text: string): string {
  if (!text.includes("<|ref|>") || !text.includes("<|det|>")) {
    return "";
  }

  const lines = text
    .replace(/<\|ref\|>.*?<\|\/ref\|>/g, "")
    .replace(/<\|det\|>.*?<\|\/det\|>/g, "\n")
    .replace(/<\/?(table|thead|tbody|tr)>/gi, "\n")
    .replace(/<\/?td>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/\*\*/g, " ").replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

  return lines.join("\n");
}

export const __testables = {
  compareAttempts
};
