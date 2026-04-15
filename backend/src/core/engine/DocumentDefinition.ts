import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type { ChunkingStrategy, ValidationResult } from "@/core/engine/types.js";

export const DOC_TYPE = {
  INVOICE: "invoice",
  BANK_STATEMENT: "bank-statement",
} as const;

type DocType = (typeof DOC_TYPE)[keyof typeof DOC_TYPE];

export interface ExtractionSchemaProperty {
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  items?: { type: string; properties?: Record<string, ExtractionSchemaProperty> };
}

export interface ExtractionSchema {
  type: "object";
  properties: Record<string, ExtractionSchemaProperty>;
  required?: string[];
}

interface BaseDocumentDefinition<TOutput> {
  readonly docType: DocType;
  readonly extractionSchema?: ExtractionSchema;
  readonly preferNativePdfText?: boolean;
  readonly nativePdfTextMinLength?: number;
  canChunk(): boolean;
  buildPrompt?(ocrText: string, blocks: OcrBlock[], pageImages: OcrPageImage[]): string;
  parseOutput(raw: string | Record<string, unknown>): TOutput;
  validateOutput?(output: TOutput): ValidationResult;
}

export interface SinglePassDocumentDefinition<TOutput> extends BaseDocumentDefinition<TOutput> {
  readonly docType: typeof DOC_TYPE.INVOICE;
}

export interface ChunkableDocumentDefinition<TOutput> extends BaseDocumentDefinition<TOutput> {
  readonly docType: typeof DOC_TYPE.BANK_STATEMENT;
  readonly chunkingStrategy?: ChunkingStrategy;
  readonly maxChunkChars?: number;
  buildChunkPrompt?(chunk: string, index: number, isFirst: boolean): string;
  readonly chunkSchema?: ExtractionSchema;
  mergeChunkOutputs?(chunks: TOutput[]): TOutput;
}

export type DocumentDefinition<TOutput> = SinglePassDocumentDefinition<TOutput> | ChunkableDocumentDefinition<TOutput>;
