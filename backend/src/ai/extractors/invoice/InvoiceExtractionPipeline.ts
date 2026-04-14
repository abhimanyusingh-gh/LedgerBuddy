import type { FieldVerifier } from "@/core/interfaces/FieldVerifier.js";
import type { ExtractedField, OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.js";
import { postProcessOcrResult, type EnhancedOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import { parseInvoiceText } from "@/ai/parsers/invoiceParser.js";
import type {
  InvoiceCompliance,
  InvoiceExtractionData,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "@/types/invoice.js";
import { logger } from "@/utils/logger.js";
import { assessInvoiceConfidence } from "@/services/invoice/confidenceAssessment.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator.js";
import type { ExtractionLearningStore } from "./learning/extractionLearningStore.js";
import type { ExtractionMappingService } from "./learning/extractionMappingService.js";
import type { DetectedInvoiceLanguage } from "./languageDetection.js";
import {
  detectInvoiceLanguage,
  detectInvoiceLanguageBeforeOcr,
  resolveDetectedLanguage,
  resolvePreOcrLanguageHint
} from "./languageDetection.js";
import type { VendorTemplateSnapshot, VendorTemplateStore } from "./learning/vendorTemplateStore.js";
import type { ConfidenceAssessment } from "@/services/invoice/confidenceAssessment.js";

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
import { validateInvoiceFields } from "./deterministicValidation.js";
import { clampProbability, formatConfidence, uniqueIssues } from "./stages/fieldParsingUtils.js";
import { addFieldDiagnosticsToMetadata, calibrateDocumentConfidence } from "./confidenceScoring/FieldConfidenceScorer.js";
import { buildFieldCandidates, buildFieldRegions } from "./stages/fieldCandidates.js";
import {
  buildRankedOcrTextCandidates,
  type RankedOcrTextCandidate
} from "./stages/ocrTextCandidates.js";
import {
  classifyOcrRecoveryStrategy,
  recoverLineItemsFromOcr,
  type OcrRecoveryStrategy
} from "./stages/lineItemRecovery.js";
import { recoverHeaderFieldsFromOcr } from "./stages/documentFieldRecovery.js";
import {
  computeSummaryTotalMinor,
  normalizeParsedAgainstOcrText,
  recoverGstSummaryFromOcr,
  recoverPreferredTotalAmountMinor
} from "./stages/totalsRecovery.js";
import {
  collectLineItemConfidence,
  mergeClassification,
  normalizeClassification,
  normalizeFieldConfidence,
  normalizeFieldProvenance,
  normalizeLineItemProvenance,
  resolveLineItemProvenance
} from "./stages/provenance.js";
import { computeVendorFingerprint } from "./learning/vendorFingerprint.js";
import * as fs from "fs/promises";
import * as path from "path";
import { DocumentProcessingEngine } from "@/core/engine/DocumentProcessingEngine.js";
import {
  InvoiceDocumentDefinition,
  type InvoiceSlmOutput,
  type InvoiceValidationContext
} from "./InvoiceDocumentDefinition.js";
import { EXTRACTION_SOURCE, type ExtractionSource } from "@/core/engine/extractionSource.js";
import { sanitizeInvoiceExtraction } from "./InvoiceExtractionSanitizer.js";

const OCR_RECOVERY_STRATEGY_SOURCE: Record<OcrRecoveryStrategy, ExtractionSource> = {
  generic: EXTRACTION_SOURCE.SLM_GENERIC,
  invoice_table: EXTRACTION_SOURCE.SLM_INVOICE_TABLE,
  receipt_statement: EXTRACTION_SOURCE.SLM_RECEIPT_STATEMENT,
};

type PipelineErrorCode = "FAILED_OCR" | "FAILED_PARSE";

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

interface LanguageResolution {
  preOcr: DetectedInvoiceLanguage;
  postOcr: DetectedInvoiceLanguage;
  resolved: DetectedInvoiceLanguage;
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

    let capturedEnhanced: EnhancedOcrResult | null = null;
    let capturedRankedCandidates: RankedOcrTextCandidate[] = [];
    let capturedPrimaryCandidate: RankedOcrTextCandidate | null = null;
    let capturedAugmentedText = "";
    let capturedOcrBlocks: OcrBlock[] = [];
    let capturedOcrPageImages: OcrPageImage[] = [];
    let capturedOcrConfidence = 0;
    let capturedOcrTokens = 0;
    let capturedExtractFields: ExtractedField[] | undefined;
    let capturedBaselineParsed: ParsedInvoiceData = {};
    let capturedFieldCandidates: Record<string, string[]> = {};
    let capturedFieldRegions: Record<string, OcrBlock[]> = {};

    const afterOcr = async (ocrResult: OcrResult, _ocrText: string) => {
      capturedOcrBlocks = ocrResult.blocks ?? [];
      capturedOcrPageImages = ocrResult.pageImages ?? [];
      capturedOcrTokens = ocrResult.tokenUsage?.totalTokens ?? 0;
      capturedExtractFields = ocrResult.fields;

      if (this.ocrDumpEnabled) {
        const enhanced = postProcessOcrResult(ocrResult);
        await this.saveOcrResult(ocrResult, enhanced);
        capturedEnhanced = enhanced;
      } else {
        capturedEnhanced = postProcessOcrResult(ocrResult);
      }

      const rawText = ocrResult.text.trim();
      const textCandidates = buildRankedOcrTextCandidates({
        rawText,
        blocks: ocrResult.blocks ?? [],
        layoutLines: capturedEnhanced.lines,
        enableKeyValueGrounding: this.enableOcrKeyValueGrounding
      });

      capturedRankedCandidates = textCandidates.ranked;
      capturedPrimaryCandidate = textCandidates.primary;
      capturedAugmentedText = textCandidates.augmentedText;

      const calibrated = calibrateDocumentConfidence(ocrResult.confidence, rawText, textCandidates.primary.text);
      capturedOcrConfidence = calibrated.score;

      metadata.ocrPrimaryVariant = textCandidates.primary.id;
      metadata.ocrPrimaryVariantScore = textCandidates.primary.score.toFixed(3);
      metadata.ocrPrimaryTokenCount = String(textCandidates.primary.metrics.tokenCount);
      metadata.ocrCandidateCount = String(textCandidates.ranked.length);
      metadata.ocrHasKeyValueGrounding = textCandidates.keyValueText.length > 0 ? "true" : "false";
      metadata.ocrHasAugmentedContext = textCandidates.augmentedText.length > 0 ? "true" : "false";
      metadata.ocrLowQualityTokenRatio = formatConfidence(textCandidates.primary.metrics.lowQualityTokenRatio);
      metadata.ocrDuplicateLineRatio = formatConfidence(textCandidates.primary.metrics.duplicateLineRatio);

      const post = detectInvoiceLanguage(textCandidates.ranked.map((candidate) => candidate.text));
      const resolved = resolveDetectedLanguage(preOcrLanguage, post);

      metadata.postOcrLanguage = post.code;
      metadata.postOcrLanguageConfidence = formatConfidence(post.confidence);
      metadata.documentLanguage = resolved.code;
      metadata.documentLanguageConfidence = formatConfidence(resolved.confidence);

      const language: LanguageResolution = { preOcr: preOcrLanguage, postOcr: post, resolved };

      const primary = capturedPrimaryCandidate!.text;

      if ((capturedExtractFields?.length ?? 0) > 0) {
        return;
      }

      if (this.llamaExtractEnabled) {
        processingIssues.push("LlamaExtract returned no structured fields.");
        return;
      }

      const baseline = parseInvoiceText(primary, { languageHint: language.resolved.code });
      const fieldCandidates = buildFieldCandidates(primary, baseline.parsed, template);
      const fieldRegions = buildFieldRegions(capturedOcrBlocks, fieldCandidates);

      metadata.baselineFieldCount = String(Object.keys(baseline.parsed).length);
      metadata.baselineWarningCount = String(baseline.warnings.length);
      metadata.fieldCandidateCount = String(Object.keys(fieldCandidates).length);
      metadata.fieldRegionCount = String(Object.keys(fieldRegions).length);

      capturedBaselineParsed = baseline.parsed;
      capturedFieldCandidates = fieldCandidates;
      capturedFieldRegions = fieldRegions;

      const chosenText = capturedAugmentedText || capturedPrimaryCandidate!.text;
      definition.buildPrompt = (_text: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]) => chosenText;

      const validationCtx: InvoiceValidationContext = {
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate,
        ocrText: primary
      };
      definition.setValidationContext(validationCtx);
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
        throw new ExtractionPipelineError("FAILED_OCR", "Empty OCR");
      }
      throw error;
    }

    if (!engineResult) {
      throw new ExtractionPipelineError("FAILED_OCR", "Engine returned no result.");
    }

    const primaryCandidate = capturedPrimaryCandidate as RankedOcrTextCandidate | null;
    const primaryText: string = primaryCandidate !== null ? primaryCandidate.text : engineResult.ocrText;
    const ocrBlocks = capturedOcrBlocks;
    const ocrPageImages = capturedOcrPageImages;
    const ocrConfidence = capturedOcrConfidence;
    const ocrTokens = capturedOcrTokens;

    if (engineResult.strategy === "llamaextract") {
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

    const slm = engineResult.output;
    processingIssues.push(...slm.issues);

    const baselineParsed: ParsedInvoiceData = capturedBaselineParsed;

    const mergedParsed = mergeParsedInvoiceData(baselineParsed, slm.parsed);
    const parsed = recoverOcrFields(mergedParsed, ocrBlocks, primaryText);
    const recoveryStrategy = classifyOcrRecoveryStrategy(ocrBlocks, primaryText);
    metadata.ocrRecoveryStrategy = recoveryStrategy;

    const validation = validateInvoiceFields({
      parsed,
      ocrText: primaryText,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate
    });

    if (!validation.valid) {
      processingIssues.push(...validation.issues);
    }

    const fieldCandidates = capturedFieldCandidates;
    const fieldRegions = capturedFieldRegions;

    const diagnostics = addFieldDiagnosticsToMetadata({
      metadata,
      parsed,
      ocrBlocks,
      fieldRegions,
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      ocrConfidence,
      validationIssues: validation.issues,
      warnings: processingIssues,
      templateAppliedFields: new Set<string>(),
      verifierChangedFields: slm.changedFields,
      verifierFieldConfidence: slm.fieldConfidence,
      verifierFieldProvenance: slm.fieldProvenance
    });

    const compliance = await this.runCompliance(parsed, input, fingerprint);

    const slmPenalty = compliance?.riskSignals?.length
      ? RiskSignalEvaluator.sumPenalties(compliance.riskSignals)
      : 0;
    const confidence = this.assessConfidenceWithPenalty(input, parsed, processingIssues, ocrConfidence, slmPenalty);

    const lineItemProvenance = resolveLineItemProvenance({
      lineItems: parsed.lineItems,
      ocrBlocks,
      verifierLineItemProvenance: slm.lineItemProvenance
    });
    const lineItemConfidence = collectLineItemConfidence(lineItemProvenance);
    const combinedFieldConfidence =
      Object.keys(lineItemConfidence).length > 0
        ? { ...diagnostics.fieldConfidence, ...lineItemConfidence }
        : diagnostics.fieldConfidence;
    const classification = mergeClassification(slm.classification, compliance?.tds?.section);

    const extraction: InvoiceExtractionData = {
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      strategy: OCR_RECOVERY_STRATEGY_SOURCE[recoveryStrategy],
      ...(classification ? { classification } : {}),
      ...(classification?.invoiceType ? { invoiceType: classification.invoiceType } : {}),
      ...(Object.keys(combinedFieldConfidence).length > 0 ? { fieldConfidence: combinedFieldConfidence } : {}),
      ...(Object.keys(diagnostics.fieldProvenance).length > 0 ? { fieldProvenance: diagnostics.fieldProvenance } : {}),
      ...(lineItemProvenance.length > 0 ? { lineItemProvenance } : {})
    };

    return {
      provider: this.ocrProvider.name,
      text: primaryText,
      confidence: ocrConfidence,
      source: EXTRACTION_SOURCE.SLM_DIRECT,
      strategy: extraction.strategy ?? EXTRACTION_SOURCE.SLM_DIRECT,
      parseResult: { parsed, warnings: processingIssues },
      confidenceAssessment: confidence,
      attempts: [],
      ocrBlocks,
      ocrPageImages,
      processingIssues: uniqueIssues(processingIssues),
      metadata,
      ocrTokens,
      slmTokens: slm.tokens,
      compliance,
      extraction
    };
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

function mergeParsedInvoiceData(base: ParsedInvoiceData, override: ParsedInvoiceData): ParsedInvoiceData {
  const baseNormalized = sanitizeInvoiceExtraction(base);
  const overrideNormalized = sanitizeInvoiceExtraction(override);
  const merged: ParsedInvoiceData = {
    ...baseNormalized,
    ...overrideNormalized
  };

  if (baseNormalized.gst || overrideNormalized.gst) {
    merged.gst = {
      ...(baseNormalized.gst ?? {}),
      ...(overrideNormalized.gst ?? {})
    };
  }

  if (overrideNormalized.lineItems && overrideNormalized.lineItems.length > 0) {
    merged.lineItems = overrideNormalized.lineItems;
  } else if (baseNormalized.lineItems && baseNormalized.lineItems.length > 0) {
    merged.lineItems = baseNormalized.lineItems;
  }

  const notes = uniqueIssues([...(baseNormalized.notes ?? []), ...(overrideNormalized.notes ?? [])]);
  if (notes.length > 0) {
    merged.notes = notes;
  }

  return sanitizeInvoiceExtraction(merged);
}

function recoverOcrFields(parsed: ParsedInvoiceData, ocrBlocks: OcrBlock[], ocrText: string): ParsedInvoiceData {
  const strategy = classifyOcrRecoveryStrategy(ocrBlocks, ocrText);
  const next = recoverHeaderFieldsFromOcr(parsed, ocrBlocks, ocrText);
  const normalized = normalizeParsedAgainstOcrText(next, ocrText, ocrBlocks);
  const recoveredGst = recoverGstSummaryFromOcr(ocrBlocks);
  if (recoveredGst) {
    normalized.gst = {
      ...(normalized.gst ?? {}),
      ...(recoveredGst.subtotalMinor !== undefined && (normalized.gst?.subtotalMinor === undefined || normalized.gst?.subtotalMinor === 0)
        ? { subtotalMinor: recoveredGst.subtotalMinor }
        : {}),
      ...(recoveredGst.cgstMinor !== undefined && (normalized.gst?.cgstMinor === undefined || normalized.gst?.cgstMinor === 0)
        ? { cgstMinor: recoveredGst.cgstMinor }
        : {}),
      ...(recoveredGst.sgstMinor !== undefined && (normalized.gst?.sgstMinor === undefined || normalized.gst?.sgstMinor === 0)
        ? { sgstMinor: recoveredGst.sgstMinor }
        : {}),
      ...(recoveredGst.igstMinor !== undefined && (normalized.gst?.igstMinor === undefined || normalized.gst?.igstMinor === 0)
        ? { igstMinor: recoveredGst.igstMinor }
        : {}),
      ...(recoveredGst.totalTaxMinor !== undefined && (normalized.gst?.totalTaxMinor === undefined || normalized.gst?.totalTaxMinor === 0)
        ? { totalTaxMinor: recoveredGst.totalTaxMinor }
        : {})
    };
  }

  const computedSummaryTotalMinor = computeSummaryTotalMinor(normalized.gst);
  if (
    computedSummaryTotalMinor !== undefined &&
    (
      normalized.totalAmountMinor === undefined ||
      normalized.totalAmountMinor <= 0 ||
      (normalized.gst?.subtotalMinor !== undefined && normalized.totalAmountMinor <= normalized.gst.subtotalMinor)
    )
  ) {
    normalized.totalAmountMinor = computedSummaryTotalMinor;
  }

  const recoveredTotalMinor = recoverPreferredTotalAmountMinor(ocrBlocks);
  const hasConsistentSummaryTotal =
    typeof normalized.totalAmountMinor === "number" &&
    computedSummaryTotalMinor !== undefined &&
    normalized.totalAmountMinor === computedSummaryTotalMinor;
  if (recoveredTotalMinor !== undefined) {
    if (
      normalized.totalAmountMinor === undefined ||
      normalized.totalAmountMinor <= 0 ||
      normalized.totalAmountMinor === recoveredTotalMinor ||
      (!hasConsistentSummaryTotal && recoveredTotalMinor !== undefined)
    ) {
      normalized.totalAmountMinor = recoveredTotalMinor;
    }
  }

  const recoveredLineItems = recoverLineItemsFromOcr(normalized.lineItems, ocrBlocks, strategy, normalized.totalAmountMinor);
  if (recoveredLineItems && recoveredLineItems.length > 0) {
    normalized.lineItems = recoveredLineItems;
  }

  return normalized;
}
