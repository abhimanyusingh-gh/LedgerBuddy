import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";

export interface DocumentDefinitionCanChunk {
  canChunk(): boolean;
}

export interface ValidationResult {
  valid: boolean;
  issues: string[];
}

export interface ProcessingContext {
  tenantId: string;
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
  ocrLanguageHint?: string;
}

export type ChunkingStrategy = "none" | "page-based" | "sliding-window";


export interface ExtractionSource {
  strategy: "llamaextract" | "slm" | "slm-chunked";
}

export interface ProcessingResult<TOutput> {
  output: TOutput;
  ocrText: string;
  ocrBlocks: OcrBlock[];
  ocrPageImages: OcrPageImage[];
  ocrConfidence?: number;
  ocrTokens: number;
  slmTokens: number;
  strategy: ExtractionSource["strategy"];
  validationResult: ValidationResult;
  processingIssues: string[];
}

export class DocumentProcessingError extends Error {
  readonly code: "FAILED_OCR" | "FAILED_PARSE";

  constructor(code: "FAILED_OCR" | "FAILED_PARSE", message: string) {
    super(message);
    this.name = "DocumentProcessingError";
    this.code = code;
  }
}
