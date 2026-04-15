import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.js";
import type { EnhancedOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import type {
  InvoiceCompliance,
  InvoiceExtractionData,
  ParsedInvoiceData
} from "@/types/invoice.js";
import { logger } from "@/utils/logger.js";
import { assessInvoiceConfidence } from "@/services/invoice/confidenceAssessment.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator.js";
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
import type { RankedOcrTextCandidate } from "@/ai/extractors/stages/ocrTextCandidates.js";
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
  compliance?: InvoiceCompliance;
  extraction?: InvoiceExtractionData;
}
import { clampProbability, formatConfidence, uniqueIssues } from "@/ai/extractors/stages/fieldParsingUtils.js";
import { computeVendorFingerprint } from "@/ai/extractors/invoice/learning/vendorFingerprint.js";
import { DocumentProcessingEngine } from "@/core/engine/DocumentProcessingEngine.js";
import {
  InvoiceDocumentDefinition,
  type InvoiceSlmOutput,
} from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import { EXTRACTION_SOURCE, type ExtractionSource } from "@/core/engine/extractionSource.js";
import { ENGINE_STRATEGY, PIPELINE_ERROR_CODE, type PipelineErrorCode } from "@/core/engine/types.js";

interface ExtractionPipelineInput {
  tenantId: string;
  sourceKey: string;
  attachmentName: string;
  fileBuffer: Buffer;
  mimeType: string;
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

    const definition = new InvoiceDocumentDefinition();
    const engine = new DocumentProcessingEngine<InvoiceSlmOutput>(
      definition,
      this.fieldVerifier,
      this.ocrProvider
    );

    // Build a shared PipelineContext that afterOcr stages populate and post-engine stages consume
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

    // Pre-populate context with data that stages need
    pipelineCtx.store.set(INVOICE_CTX.PRE_OCR_LANGUAGE, preOcrLanguage);
    if (template) {
      pipelineCtx.store.set(INVOICE_CTX.VENDOR_TEMPLATE, template);
    }

    // Build the afterOcr sub-pipeline (stages 1-8)
    // Stages 6-8 (baseline parse, augment prompt, set validation) are skipped when
    // LlamaExtract produces structured fields — handled via the early-exit check stage.
    const afterOcrPipeline = buildInvoiceAfterOcrPipeline({
      definition,
      enableKeyValueGrounding: this.enableOcrKeyValueGrounding,
      template,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate,
      llamaExtractEnabled: this.llamaExtractEnabled,
    });

    // The afterOcr callback delegates to the composable pipeline stages
    const afterOcr = async (ocrResult: OcrResult, _ocrText: string) => {
      pipelineCtx.store.set(INVOICE_CTX.OCR_RESULT, ocrResult);
      await afterOcrPipeline.executeWithContext(pipelineCtx);

      // Save OCR dump if enabled (side-effect, not part of pipeline data flow)
      if (this.ocrDumpEnabled) {
        const enhanced = pipelineCtx.store.require<EnhancedOcrResult>(INVOICE_CTX.ENHANCED_OCR);
        await this.saveOcrResult(ocrResult, enhanced);
      }
    };

    let engineResult: import("@/core/engine/types.js").ProcessingResult<InvoiceSlmOutput> | undefined;
    try {
      engineResult = await engine.process(
        {
          tenantId: input.tenantId,
          fileName: input.attachmentName,
          mimeType: input.mimeType,
          fileBuffer: input.fileBuffer,
          ocrLanguageHint: preOcrLanguageHint.hint
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

    // Read values populated by afterOcr pipeline stages from the shared context
    const primaryCandidate = pipelineCtx.store.get<RankedOcrTextCandidate>(INVOICE_CTX.PRIMARY_CANDIDATE);
    const primaryText: string = primaryCandidate !== null && primaryCandidate !== undefined
      ? primaryCandidate.text
      : engineResult.ocrText;
    const ocrBlocks = pipelineCtx.store.get<OcrBlock[]>(INVOICE_CTX.OCR_BLOCKS) ?? [];
    const ocrPageImages = pipelineCtx.store.get<OcrPageImage[]>(INVOICE_CTX.OCR_PAGE_IMAGES) ?? [];
    const ocrConfidence = pipelineCtx.store.get<number>(INVOICE_CTX.OCR_CONFIDENCE) ?? 0;
    const ocrTokens = pipelineCtx.store.get<number>(INVOICE_CTX.OCR_TOKENS) ?? 0;

    // Handle LlamaExtract early return path (bypass post-engine pipeline)
    if (engineResult.strategy === ENGINE_STRATEGY.LLAMA_EXTRACT) {
      const slmOutput = engineResult.output;
      const parsed = slmOutput.parsed;
      const fieldProvenance = slmOutput.fieldProvenance ?? {};

      const compliance = await this.runCompliance(parsed, input, fingerprint);
      const llamaPenalty = compliance?.riskSignals?.length
        ? RiskSignalEvaluator.sumPenalties(compliance.riskSignals)
        : 0;
      const confidence = this.assessConfidenceWithPenalty(input, parsed, processingIssues, ocrConfidence, llamaPenalty);

      const extraction: InvoiceExtractionData = {
        source: EXTRACTION_SOURCE.LLAMA_EXTRACT,
        strategy: EXTRACTION_SOURCE.LLAMA_EXTRACT,
        ...(Object.keys(fieldProvenance).length > 0 ? { fieldProvenance } : {})
      };

      return {
        provider: this.ocrProvider.name,
        text: primaryText,
        confidence: ocrConfidence,
        source: EXTRACTION_SOURCE.LLAMA_EXTRACT,
        strategy: EXTRACTION_SOURCE.LLAMA_EXTRACT,
        parseResult: { parsed, warnings: processingIssues },
        confidenceAssessment: confidence,
        attempts: [],
        ocrBlocks,
        ocrPageImages,
        processingIssues: uniqueIssues(processingIssues),
        metadata,
        ocrTokens,
        slmTokens: 0,
        compliance,
        extraction
      };
    }

    // --- Post-engine pipeline (stages 9-16) ---
    // Populate context with engine output and OCR provider name for the post-engine stages
    pipelineCtx.store.set(POST_ENGINE_CTX.SLM_OUTPUT, engineResult.output);
    pipelineCtx.store.set("invoice.ocrProviderName", this.ocrProvider.name);

    const postEnginePipeline = createInvoicePostEnginePipeline({
      complianceEnricher: this.complianceEnricher,
    });

    // Store vendor content hash for compliance enrichment stage
    metadata.vendorContentHash = fingerprint.hash;

    const postEngineResult = await postEnginePipeline.executeWithContext(pipelineCtx);
    return postEngineResult.output;
  }

  private async runCompliance(
    parsed: ParsedInvoiceData,
    input: ExtractionPipelineInput,
    fingerprint: ReturnType<typeof computeVendorFingerprint>
  ) {
    if (!this.complianceEnricher) return;
    try {
      return await this.complianceEnricher.enrich(parsed, input.tenantId, fingerprint.key, {
        contentHash: fingerprint.hash
      });
    } catch (error) {
      logger.warn("compliance.enrich.failed", { tenantId: input.tenantId, error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  private assessConfidenceWithPenalty(
      input: ExtractionPipelineInput,
      parsed: ParsedInvoiceData,
      warnings: string[],
      ocrConfidence: number | undefined,
      penalty: number
  ) {
    return assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      autoSelectMin: input.autoSelectMin,
      referenceDate: input.referenceDate,
      complianceRiskPenalty: penalty
    });
  }

  async saveOcrResult(result: OcrResult, enhanced: EnhancedOcrResult) {
    const filePath = path.join("/tmp", "ocr_dumps", `${Date.now()}.json`);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ raw: result, enhanced }, null, 2));
    logger.info("ocr.dump.saved", { filePath });
  }

}
