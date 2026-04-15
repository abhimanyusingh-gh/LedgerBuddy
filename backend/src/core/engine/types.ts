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

export const ENGINE_STRATEGY = {
  LLAMA_EXTRACT: "llamaextract",
  SLM: "slm",
  SLM_CHUNKED: "slm-chunked",
} as const;

export type EngineStrategy = (typeof ENGINE_STRATEGY)[keyof typeof ENGINE_STRATEGY];

export interface ProcessingResult<TOutput> {
  output: TOutput;
  ocrText: string;
  ocrBlocks: OcrBlock[];
  ocrPageImages: OcrPageImage[];
  ocrConfidence?: number;
  ocrTokens: number;
  slmTokens: number;
  strategy: EngineStrategy;
  validationResult: ValidationResult;
  processingIssues: string[];
}

export const PIPELINE_ERROR_CODE = {
  FAILED_OCR: "FAILED_OCR",
  FAILED_PARSE: "FAILED_PARSE",
} as const;

export type PipelineErrorCode = (typeof PIPELINE_ERROR_CODE)[keyof typeof PIPELINE_ERROR_CODE];

export class DocumentProcessingError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string) {
    super(message);
    this.name = "DocumentProcessingError";
    this.code = code;
  }
}
