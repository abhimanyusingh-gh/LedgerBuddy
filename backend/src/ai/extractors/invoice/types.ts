import type { OcrBlock, OcrPageImage } from "../../../core/interfaces/OcrProvider.js";
import type { InvoiceCompliance, InvoiceExtractionData, ParsedInvoiceData } from "../../../types/invoice.js";
import type { ConfidenceAssessment } from "../../../services/invoice/confidenceAssessment.js";

export interface ParseResult {
  parsed: ParsedInvoiceData;
  warnings: string[];
}

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
  ocrTokens?: number;
  slmTokens?: number;
  compliance?: InvoiceCompliance;
  extraction?: InvoiceExtractionData;
}
