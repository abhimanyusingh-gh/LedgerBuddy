import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.js";
import type { DocumentMimeType } from "@/types/mime.js";
import type { EnhancedOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import type {
  InvoiceExtractionData,
  ParsedInvoiceData
} from "@/types/invoice.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import type { ExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import type { ExtractionMappingService } from "@/ai/extractors/invoice/learning/extractionMappingService.js";
import {
  detectInvoiceLanguageBeforeOcr,
  resolvePreOcrLanguageHint
} from "@/ai/extractors/invoice/languageDetection.js";
import type { VendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import type { ConfidenceAssessment } from "@/services/invoice/confidenceAssessment.js";
import { ContextStore } from "@/core/pipeline/PipelineContext.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";
import { buildInvoiceAfterOcrPipeline } from "@/ai/extractors/invoice/pipeline/invoiceAfterOcrPipeline.js";
import { createInvoicePostEnginePipeline } from "@/ai/extractors/invoice/pipeline/invoicePostEnginePipeline.js";
import * as fs from "fs/promises";
import * as path from "path";

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
  compliance?: import("@/types/invoice.js").InvoiceCompliance;
  extraction?: InvoiceExtractionData;
}
import { clampProbability, formatConfidence } from "@/ai/extractors/stages/fieldParsingUtils.js";
import { computeVendorFingerprint } from "@/ai/extractors/invoice/learning/vendorFingerprint.js";
import { DocumentProcessingEngine } from "@/core/engine/DocumentProcessingEngine.js";
import {
  InvoiceDocumentDefinition,
  type InvoiceSlmOutput,
} from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import { type ExtractionSource } from "@/core/engine/extractionSource.js";
import { PIPELINE_ERROR_CODE, type PipelineErrorCode } from "@/core/engine/types.js";
import { logger } from "@/utils/logger.js";

interface ExtractionPipelineInput {
  tenantId: string;
  sourceKey: string;
  attachmentName: string;
  fileBuffer: Buffer;
  mimeType: DocumentMimeType;
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  autoSelectMin: number;
  referenceDate?: Date;
}

interface ExtractionPipelineOptions {
  ocrHighConfidenceThreshold?: number;
  enableOcrKeyValueGrounding?: boolean;
  llmAssistConfidenceThreshold?: number;
  learningMode?: "active" | "assistive";
  ocrDumpEnabled?: boolean;
  llamaExtractEnabled?: boolean;
}

export class ExtractionPipelineError extends Error {
  constructor(readonly code: PipelineErrorCode, message: string) {
    super(message);
    this.name = "ExtractionPipelineError";
  }
}

interface ExtractionPipelineDeps {
  ocrProvider: OcrProvider;
  fieldVerifier: FieldVerifier;
  templateStore: VendorTemplateStore;
  learningStore?: ExtractionLearningStore;
  complianceEnricher?: ComplianceEnricher;
  mappingService?: ExtractionMappingService;
}

export class InvoiceExtractionPipeline {
  private readonly ocrProvider: OcrProvider;
  private readonly fieldVerifier: FieldVerifier;
  private readonly templateStore: VendorTemplateStore;
  private readonly learningStore?: ExtractionLearningStore;
  private readonly complianceEnricher?: ComplianceEnricher;
  private readonly mappingService?: ExtractionMappingService;
  private readonly ocrHighConfidenceThreshold: number;
  private readonly enableOcrKeyValueGrounding: boolean;
  private readonly llmAssistConfidenceThreshold: number;
  private readonly learningMode: "active" | "assistive";
  private readonly ocrDumpEnabled: boolean;
  private readonly llamaExtractEnabled: boolean;

  constructor(deps: ExtractionPipelineDeps, options?: ExtractionPipelineOptions) {
    this.ocrProvider = deps.ocrProvider;
    this.fieldVerifier = deps.fieldVerifier;
    this.templateStore = deps.templateStore;
    this.learningStore = deps.learningStore;
    this.complianceEnricher = deps.complianceEnricher;
    this.mappingService = deps.mappingService;
    this.ocrHighConfidenceThreshold = clampProbability(options?.ocrHighConfidenceThreshold ?? 0.88);
    this.enableOcrKeyValueGrounding = options?.enableOcrKeyValueGrounding ?? true;
    this.llmAssistConfidenceThreshold = options?.llmAssistConfidenceThreshold ?? 85;
    this.learningMode = options?.learningMode ?? "assistive";
    this.ocrDumpEnabled = options?.ocrDumpEnabled ?? process.env.OCR_DUMP_ENABLED === "true";
    this.llamaExtractEnabled = options?.llamaExtractEnabled ?? false;
  }

  async extract(input: ExtractionPipelineInput): Promise<PipelineExtractionResult> {
    const ctx = await this.buildContext(input);
    const engineResult = await this.runEngine(ctx, input);
    return this.runPostEnginePipeline(ctx, engineResult);
  }

  private async buildContext(input: ExtractionPipelineInput): Promise<PipelineContext> {
    const metadata: Record<string, string> = {};
    const processingIssues: string[] = [];

    const fingerprint = computeVendorFingerprint({
      buffer: input.fileBuffer,
      mimeType: input.mimeType,
      sourceKey: input.sourceKey,
      attachmentName: input.attachmentName
    });

    metadata.vendorFingerprint = fingerprint.key;
    metadata.layoutSignature = fingerprint.layoutSignature;
    metadata.vendorContentHash = fingerprint.hash;

    const template = await this.templateStore.findByFingerprint(input.tenantId, fingerprint.key);
    metadata.vendorTemplateMatched = template ? "true" : "false";

    const preOcrLanguage = detectInvoiceLanguageBeforeOcr(input);
    const preOcrLanguageHint = resolvePreOcrLanguageHint(preOcrLanguage, input.mimeType);
    metadata.preOcrLanguage = preOcrLanguage.code;
    metadata.preOcrLanguageConfidence = formatConfidence(preOcrLanguage.confidence);
    metadata.preOcrLanguageHintReason = preOcrLanguageHint.reason;
    if (preOcrLanguageHint.hint) {
      metadata.preOcrLanguageHint = preOcrLanguageHint.hint;
    }

    const pipelineCtx: PipelineContext = {
      input: {
        tenantId: input.tenantId,
        fileName: input.attachmentName,
        mimeType: input.mimeType,
        fileBuffer: input.fileBuffer,
        sourceKey: input.sourceKey,
        attachmentName: input.attachmentName,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        autoSelectMin: input.autoSelectMin,
        referenceDate: input.referenceDate,
      },
      store: new ContextStore(),
      metadata,
      issues: processingIssues,
    };

    pipelineCtx.store.set(INVOICE_CTX.PRE_OCR_LANGUAGE, preOcrLanguage);
    if (template) {
      pipelineCtx.store.set(INVOICE_CTX.VENDOR_TEMPLATE, template);
    }

    return pipelineCtx;
  }

  private async runEngine(
    ctx: PipelineContext,
    input: ExtractionPipelineInput
  ): Promise<import("@/core/engine/types.js").ProcessingResult<InvoiceSlmOutput>> {
    const template = ctx.store.get<import("@/ai/extractors/invoice/learning/vendorTemplateStore.js").VendorTemplateSnapshot>(INVOICE_CTX.VENDOR_TEMPLATE);
    const definition = new InvoiceDocumentDefinition();
    const engine = new DocumentProcessingEngine<InvoiceSlmOutput>(
      definition,
      this.fieldVerifier,
      this.ocrProvider
    );

    const afterOcrPipeline = buildInvoiceAfterOcrPipeline({
      definition,
      enableKeyValueGrounding: this.enableOcrKeyValueGrounding,
      template,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate,
      llamaExtractEnabled: this.llamaExtractEnabled,
    });

    const afterOcr = async (ocrResult: OcrResult, _ocrText: string) => {
      ctx.store.set(INVOICE_CTX.OCR_RESULT, ocrResult);
      await afterOcrPipeline.executeWithContext(ctx);

      if (this.ocrDumpEnabled) {
        const enhanced = ctx.store.require<EnhancedOcrResult>(INVOICE_CTX.ENHANCED_OCR);
        await this.saveOcrResult(ocrResult, enhanced);
      }
    };

    const preOcrLanguageHint = ctx.metadata.preOcrLanguageHint;

    let engineResult: import("@/core/engine/types.js").ProcessingResult<InvoiceSlmOutput> | undefined;
    try {
      engineResult = await engine.process(
        {
          tenantId: input.tenantId,
          fileName: input.attachmentName,
          mimeType: input.mimeType,
          fileBuffer: input.fileBuffer,
          ocrLanguageHint: preOcrLanguageHint
        },
        undefined,
        afterOcr
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Empty OCR")) {
        throw new ExtractionPipelineError(PIPELINE_ERROR_CODE.FAILED_OCR, "Empty OCR");
      }
      throw error;
    }

    if (!engineResult) {
      throw new ExtractionPipelineError(PIPELINE_ERROR_CODE.FAILED_OCR, "Engine returned no result.");
    }

    return engineResult;
  }

  private async runPostEnginePipeline(
    ctx: PipelineContext,
    engineResult: import("@/core/engine/types.js").ProcessingResult<InvoiceSlmOutput>
  ): Promise<PipelineExtractionResult> {
    if (!ctx.store.has(INVOICE_CTX.PRIMARY_TEXT)) {
      ctx.store.set(INVOICE_CTX.PRIMARY_TEXT, engineResult.ocrText);
    }

    ctx.store.set(POST_ENGINE_CTX.SLM_OUTPUT, engineResult.output);
    ctx.store.set(POST_ENGINE_CTX.ENGINE_STRATEGY, engineResult.strategy);
    ctx.store.set("invoice.ocrProviderName", this.ocrProvider.name);

    const postEnginePipeline = createInvoicePostEnginePipeline({
      complianceEnricher: this.complianceEnricher,
    });

    const postEngineResult = await postEnginePipeline.executeWithContext(ctx);
    return postEngineResult.output;
  }

  async saveOcrResult(result: OcrResult, enhanced: EnhancedOcrResult) {
    const filePath = path.join("/tmp", "ocr_dumps", `${Date.now()}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ raw: result, enhanced }, null, 2));
    logger.info("ocr.dump.saved", { filePath });
  }

}
