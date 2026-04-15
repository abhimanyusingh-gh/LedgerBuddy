import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.js";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.js";
import type { ChunkableDocumentDefinition, DocumentDefinition } from "@/core/engine/DocumentDefinition.js";
import type { DocumentDefinitionCanChunk, ProcessingContext, ProcessingResult, ValidationResult } from "@/core/engine/types.js";
import { DocumentProcessingError } from "@/core/engine/types.js";

import { extractNativePdfText } from "@/ai/extractors/stages/nativePdfText.js";
import { logger } from "@/utils/logger.js";
import { buildExtractionPromptFromSchema } from "@/core/engine/promptFromSchema.js";

export const OCR_SENTINEL_KEY = "__bank_statement_extraction__" as const;

export type DocumentProcessingProgressEvent =
  | { type: "progress"; stage: "slm-chunk"; chunk: number; totalChunks: number };

export class DocumentProcessingEngine<TOutput> {
  private readonly ocrProvider: OcrProvider | null;
  private readonly fieldVerifier: FieldVerifier;
  private readonly definition: DocumentDefinition<TOutput> & DocumentDefinitionCanChunk;

  constructor(
    definition: DocumentDefinition<TOutput>,
    fieldVerifier: FieldVerifier,
    ocrProvider?: OcrProvider | null
  ) {
    this.definition = definition as DocumentDefinition<TOutput> & DocumentDefinitionCanChunk;
    this.fieldVerifier = fieldVerifier;
    this.ocrProvider = ocrProvider ?? null;
  }

  async process(
    ctx: ProcessingContext,
    onProgress?: (event: DocumentProcessingProgressEvent) => void,
    afterOcr?: (ocrResult: OcrResult, ocrText: string) => Promise<void> | void
  ): Promise<ProcessingResult<TOutput>> {
    const processingIssues: string[] = [];

    const { text, ocrResult, ocrTokens, ocrConfidence } = await this.runOcrStage(ctx, onProgress);

    if (afterOcr) {
      await afterOcr(ocrResult, text);
    }

    if (ocrResult.fields && ocrResult.fields.length > 0) {
      const fieldsAsRecord: Record<string, unknown> = {};
      const extractProvenance: Record<string, { page?: number; bboxNormalized?: [number, number, number, number]; confidence?: number }> = {};
      for (const field of ocrResult.fields) {
        fieldsAsRecord[field.key] = field.value;
        if (field.page !== undefined || field.bboxNormalized !== undefined || field.confidence !== undefined) {
          extractProvenance[field.key] = {
            ...(field.page !== undefined ? { page: field.page } : {}),
            ...(field.bboxNormalized !== undefined ? { bboxNormalized: field.bboxNormalized } : {}),
            ...(field.confidence !== undefined ? { confidence: field.confidence } : {})
          };
        }
      }
      if (ocrResult.extractedLineItems && ocrResult.extractedLineItems.length > 0) {
        fieldsAsRecord["line_items"] = ocrResult.extractedLineItems;
      }
      if (Object.keys(extractProvenance).length > 0) {
        fieldsAsRecord["__extract_provenance__"] = extractProvenance;
      }
      const output = this.definition.parseOutput(fieldsAsRecord);
      const validationResult = this.runValidation(output, processingIssues);
      return {
        output,
        ocrText: text,
        ocrBlocks: ocrResult.blocks ?? [],
        ocrPageImages: ocrResult.pageImages ?? [],
        ocrConfidence,
        ocrTokens,
        slmTokens: 0,
        strategy: "llamaextract",
        validationResult,
        processingIssues
      };
    }

    const chunkDef = this.definition.canChunk() ? (this.definition as unknown as ChunkableDocumentDefinition<TOutput>) : null;
    const maxChunkChars = chunkDef?.maxChunkChars ?? 8000;
    const canChunk = Boolean(chunkDef?.mergeChunkOutputs);

    if (text.length > maxChunkChars && canChunk) {
      return this.runChunkedSlm(text, ctx, ocrResult, ocrTokens, ocrConfidence, processingIssues, onProgress);
    }

    const { output, slmTokens } = await this.runSingleSlm(text, ocrResult, ctx.mimeType);
    const validationResult = this.runValidation(output, processingIssues);

    return {
      output,
      ocrText: text,
      ocrBlocks: ocrResult.blocks ?? [],
      ocrPageImages: ocrResult.pageImages ?? [],
      ocrConfidence,
      ocrTokens,
      slmTokens,
      strategy: "slm",
      validationResult,
      processingIssues
    };
  }

  private async runOcrStage(
    ctx: ProcessingContext,
    _onProgress?: (event: DocumentProcessingProgressEvent) => void
  ): Promise<{ text: string; ocrResult: OcrResult; ocrTokens: number; ocrConfidence: number | undefined; source: "ocr" | "native-pdf" }> {
    if (this.definition.preferNativePdfText) {
      const minLength = this.definition.nativePdfTextMinLength ?? 100;
      const nativeText = extractNativePdfText(ctx.fileBuffer, ctx.mimeType);
      if (nativeText.length >= minLength) {
        return {
          text: nativeText,
          ocrResult: { text: nativeText, provider: "native-pdf", blocks: [], pageImages: [] },
          ocrTokens: 0,
          ocrConfidence: undefined,
          source: "native-pdf"
        };
      }

      if (!this.ocrProvider) {
        throw new DocumentProcessingError(
          "FAILED_OCR",
          "Native PDF text extraction yielded insufficient text and OCR provider is not available."
        );
      }

      logger.info("engine.ocr.native.insufficient", {
        docType: this.definition.docType,
        fileName: ctx.fileName,
        nativeTextLength: nativeText.length,
        threshold: minLength
      });
    }

    if (!this.ocrProvider) {
      throw new DocumentProcessingError("FAILED_OCR", "No OCR provider available.");
    }

    let ocrResult: OcrResult;
    try {
      ocrResult = await this.ocrProvider.extractText(ctx.fileBuffer, ctx.mimeType, ctx.ocrLanguageHint ? { languageHint: ctx.ocrLanguageHint } : undefined);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new DocumentProcessingError("FAILED_OCR", `OCR extraction failed: ${msg}`);
    }

    const text = ocrResult.text?.trim() ?? "";
    if (!text) {
      throw new DocumentProcessingError("FAILED_OCR", "Empty OCR");
    }

    const ocrTokens = ocrResult.tokenUsage?.totalTokens ?? 0;
    const ocrConfidence = ocrResult.confidence;

    return { text, ocrResult, ocrTokens, ocrConfidence, source: "ocr" };
  }

  private async runSingleSlm(
    text: string,
    ocrResult: OcrResult,
    mimeType: string
  ): Promise<{ output: TOutput; slmTokens: number }> {
    const blocks = ocrResult.blocks ?? [];
    const pageImages = ocrResult.pageImages ?? [];
    const output = await this.invokeSlmForOutput(text, blocks, pageImages, mimeType);
    return { output, slmTokens: 0 };
  }

  private async invokeSlmForOutput(
    text: string,
    blocks: OcrBlock[],
    pageImages: OcrPageImage[],
    mimeType: string
  ): Promise<TOutput> {
    const prompt = this.definition.buildPrompt
      ? this.definition.buildPrompt(text, blocks, pageImages)
      : this.buildPromptFromSchema(text, false);
    const rawJson = await this.callSlm(prompt, mimeType, pageImages);
    return this.definition.parseOutput(rawJson);
  }

  private buildPromptFromSchema(text: string, isChunkContinuation: boolean): string {
    const def = this.definition;
    const chunkDef = def.canChunk() ? (def as unknown as ChunkableDocumentDefinition<TOutput>) : null;
    const schema = isChunkContinuation && chunkDef?.chunkSchema
      ? chunkDef.chunkSchema
      : def.extractionSchema;
    if (!schema) {
      return text;
    }
    return buildExtractionPromptFromSchema(text, schema);
  }

  private async runChunkedSlm(
    text: string,
    ctx: ProcessingContext,
    ocrResult: OcrResult,
    ocrTokens: number,
    ocrConfidence: number | undefined,
    processingIssues: string[],
    onProgress?: (event: DocumentProcessingProgressEvent) => void
  ): Promise<ProcessingResult<TOutput>> {
    const chunks = this.splitTextIntoChunks(text);
    const chunkOutputs: TOutput[] = [];

    for (let i = 0; i < chunks.length; i++) {
      onProgress?.({ type: "progress", stage: "slm-chunk", chunk: i + 1, totalChunks: chunks.length });

      const isFirst = i === 0;
      try {
        const def = this.definition as ChunkableDocumentDefinition<TOutput>;
        const prompt = def.buildChunkPrompt
          ? def.buildChunkPrompt(chunks[i], i, isFirst)
          : this.buildPromptFromSchema(chunks[i], !isFirst);
        const rawJson = await this.callSlm(prompt, ctx.mimeType, []);
        const output = this.definition.parseOutput(rawJson);
        chunkOutputs.push(output);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        processingIssues.push(`Chunk ${i + 1}/${chunks.length} failed: ${msg}`);
      }
    }

    const def = this.definition as ChunkableDocumentDefinition<TOutput>;
    const mergedOutput = def.mergeChunkOutputs!(chunkOutputs);
    const validationResult = this.runValidation(mergedOutput, processingIssues);

    return {
      output: mergedOutput,
      ocrText: text,
      ocrBlocks: ocrResult.blocks ?? [],
      ocrPageImages: ocrResult.pageImages ?? [],
      ocrConfidence,
      ocrTokens,
      slmTokens: 0,
      strategy: "slm-chunked",
      validationResult,
      processingIssues
    };
  }

  private async callSlm(prompt: string, mimeType: string, _pageImages: OcrPageImage[]): Promise<string> {
    const input: FieldVerifierInput = {
      parsed: { invoiceNumber: OCR_SENTINEL_KEY } as ParsedInvoiceData,
      ocrText: prompt,
      ocrBlocks: [],
      mode: "relaxed",
      hints: {
        mimeType,
        vendorTemplateMatched: false,
        fieldCandidates: {},
        llmAssist: true
      }
    };
    const verifierResult = await this.fieldVerifier.verify(input);
    return this.extractRawJson(verifierResult);
  }

  private extractRawJson(verifierResult: FieldVerifierResult): string {
    const contract = verifierResult.contract;
    const rawParsed = verifierResult.parsed as unknown as Record<string, unknown>;
    const rawJson =
      (contract as unknown as Record<string, unknown>)?.rawJson ??
      rawParsed?.rawJson ??
      rawParsed?.bankStatementData;

    if (typeof rawJson === "string") {
      return rawJson;
    } else if (rawJson && typeof rawJson === "object") {
      return JSON.stringify(rawJson);
    }
    return JSON.stringify(rawParsed);
  }

  private runValidation(output: TOutput, processingIssues: string[]): ValidationResult {
    if (!this.definition.validateOutput) {
      return { valid: true, issues: [] };
    }
    const result = this.definition.validateOutput(output);
    if (!result.valid) {
      processingIssues.push(...result.issues);
    }
    return result;
  }

  private splitTextIntoChunks(text: string): string[] {
    const chunkableDef = this.definition.canChunk() ? (this.definition as unknown as ChunkableDocumentDefinition<TOutput>) : null;
    const maxChunkChars = chunkableDef?.maxChunkChars ?? 8000;
    const chunkTargetSize = Math.floor(maxChunkChars * 0.75);

    const pageBreaks = text.split(/\n(?=\f)|(?<=\f)\n|\f/);
    const pages = pageBreaks.length > 1
      ? pageBreaks.filter(p => p.trim().length > 0)
      : [text];

    if (pages.length > 1) {
      const chunks: string[] = [];
      let current = "";

      for (const page of pages) {
        if (current.length + page.length > chunkTargetSize && current.length > 0) {
          chunks.push(current);
          current = page;
        } else {
          current += (current ? "\n" : "") + page;
        }
      }
      if (current.trim()) {
        chunks.push(current);
      }
      return chunks.length > 0 ? chunks : [text];
    }

    const lines = text.split("\n");
    const chunks: string[] = [];
    let current = "";

    for (const line of lines) {
      if (current.length + line.length + 1 > chunkTargetSize && current.length > 0) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? "\n" : "") + line;
      }
    }
    if (current.trim()) {
      chunks.push(current);
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
