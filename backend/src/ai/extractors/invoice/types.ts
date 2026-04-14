import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type { InvoiceCompliance, InvoiceExtractionData, ParsedInvoiceData } from "@/types/invoice.js";
import type { ConfidenceAssessment } from "@/services/invoice/confidenceAssessment.js";
import type { ExtractionSource } from "@/core/engine/extractionSource.js";

export interface ParseResult {
  parsed: ParsedInvoiceData;
  warnings: string[];
}

export interface ExtractionAttemptSummary {
  provider: string;
  source: ExtractionSource;
  strategy: ExtractionSource;
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
  source: ExtractionSource;
  strategy: ExtractionSource;
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
