import type { OcrBlock, OcrPageImage } from "../../core/interfaces/OcrProvider.js";
import type { ParseResult } from "../../parser/invoiceParser.js";
import type { ConfidenceAssessment } from "../confidenceAssessment.js";

export interface ExtractionAttemptSummary {
  provider: string;
  source: string;
  strategy: string;
  score: number;
  confidenceScore: number;
  warningCount: number;
  hasTotalAmountMinor: boolean;
  textLength: number;
}

export interface PipelineExtractionResult {
  provider: string;
  text: string;
  confidence?: number;
  source: string;
  strategy: string;
  parseResult: ParseResult;
  confidenceAssessment: ConfidenceAssessment;
  attempts: ExtractionAttemptSummary[];
  ocrBlocks: OcrBlock[];
  ocrPageImages: OcrPageImage[];
  processingIssues: string[];
  metadata: Record<string, string>;
}
