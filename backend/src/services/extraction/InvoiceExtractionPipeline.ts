import type { FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrPageImage, OcrProvider } from "../../core/interfaces/OcrProvider.js";
import type {
  InvoiceExtractionData,
  ParsedInvoiceData
} from "../../types/invoice.js";
import { assessInvoiceConfidence, type ConfidenceAssessment } from "../confidenceAssessment.js";
import { buildLayoutGraph } from "./layoutGraph.js";
import { validateInvoiceFields } from "./deterministicValidation.js";
import { computeVendorFingerprint } from "./vendorFingerprint.js";
import { templateFromParsed, type VendorTemplateStore } from "./vendorTemplateStore.js";
import type { ExtractionLearningStore } from "./extractionLearningStore.js";
import type { PipelineExtractionResult } from "./types.js";
import { logger } from "../../utils/logger.js";
import { detectInvoiceLanguage, detectInvoiceLanguageBeforeOcr } from "./languageDetection.js";
import { parseInvoiceText } from "../../parser/invoiceParser.js";
import type { ComplianceEnricher } from "../compliance/ComplianceEnricher.js";
import { RiskSignalEvaluator } from "../compliance/RiskSignalEvaluator.js";
import {
  addFieldDiagnosticsToMetadata,
  calibrateDocumentConfidence,
} from "./pipeline/diagnostics.js";
import {
  classifyOcrRecoveryStrategy,
  findPreferredTotalAmountBlockForStrategy,
  findPreferredVendorBlockForStrategy,
} from "./pipeline/ocrRecovery.js";
import { extractNativePdfText } from "./pipeline/nativePdfText.js";
import {
  buildFieldCandidates,
  buildFieldRegions
} from "./pipeline/fieldCandidates.js";
import {
  mergeClassification,
  normalizeBlockIndices,
  normalizeClassification,
  normalizeFieldConfidence,
  normalizeFieldProvenance,
  normalizeLineItemProvenance,
  collectLineItemConfidence,
  resolveLineItemProvenance
} from "./pipeline/provenance.js";
import {
  buildAugmentedGroundingText,
  buildBlocksText,
  buildKeyValueGroundingText,
  clampProbability,
  formatConfidence,
  resolveDetectedLanguage,
  resolvePreOcrLanguageHint,
  selectDateProvenanceBlock,
  selectInvoiceNumberProvenanceBlock,
  isNearDuplicateText,
  uniqueIssues
} from "./invoiceExtractionPipelineHelpers.js";

interface ExtractionTextCandidate {
  text: string;
  provider: string;
  confidence?: number;
  source: string;
}

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
}

export class ExtractionPipelineError extends Error {
  constructor(
    readonly code: PipelineErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ExtractionPipelineError";
  }
}

export class InvoiceExtractionPipeline {
  private readonly ocrHighConfidenceThreshold: number;
  private readonly enableOcrKeyValueGrounding: boolean;
  private readonly llmAssistConfidenceThreshold: number;
  private readonly verifierTimeoutMs: number;
  private readonly learningMode: "active" | "assistive";

  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly fieldVerifier: FieldVerifier,
    private readonly templateStore: VendorTemplateStore,
    private readonly learningStore: ExtractionLearningStore | undefined,
    options?: ExtractionPipelineOptions,
    private readonly complianceEnricher?: ComplianceEnricher
  ) {
    this.ocrHighConfidenceThreshold = clampProbability(options?.ocrHighConfidenceThreshold ?? 0.88);
    this.enableOcrKeyValueGrounding = options?.enableOcrKeyValueGrounding ?? true;
    this.llmAssistConfidenceThreshold = options?.llmAssistConfidenceThreshold ?? 85;
    this.verifierTimeoutMs = 120_000;
    this.learningMode = options?.learningMode ?? "assistive";
  }

  async extract(input: ExtractionPipelineInput): Promise<PipelineExtractionResult> {
    const metadata: Record<string, string> = {};
    const processingIssues: string[] = [];
    const templateAppliedFields = new Set<string>();

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
    if (template) {
      metadata.vendorTemplateVendor = template.vendorName;
    }

    const extractionCandidates: ExtractionTextCandidate[] = [];

    let ocrProvider = this.ocrProvider.name;
    let ocrConfidence: number | undefined;
    let ocrBlocks: OcrBlock[] = [];
    let ocrPageImages: OcrPageImage[] = [];
    let rawTextForNormalization = "";
    const nativePdfText = extractNativePdfText(input.fileBuffer, input.mimeType);
    let ocrTokensUsed = 0;
    let slmTokensUsed = 0;
    const preOcrLanguage = detectInvoiceLanguageBeforeOcr({
      attachmentName: input.attachmentName,
      sourceKey: input.sourceKey,
      mimeType: input.mimeType,
      fileBuffer: input.fileBuffer
    });
    const preOcrLanguageHintDecision = resolvePreOcrLanguageHint(preOcrLanguage, input.mimeType);
    const preOcrLanguageHint = preOcrLanguageHintDecision.hint;
    if (preOcrLanguageHintDecision.reason !== "detected" && preOcrLanguageHintDecision.reason !== "none" && preOcrLanguageHint) {
      metadata.preOcrLanguageHint = preOcrLanguageHint;
      metadata.preOcrLanguageHintReason = preOcrLanguageHintDecision.reason;
    }
    if (preOcrLanguage.code !== "und") {
      metadata.preOcrLanguage = preOcrLanguage.code;
      metadata.preOcrLanguageConfidence = formatConfidence(preOcrLanguage.confidence);
      if (preOcrLanguage.signals.length > 0) {
        metadata.preOcrLanguageSignals = preOcrLanguage.signals.join(",");
      }
    }

    try {
      const ocrResult = await this.ocrProvider.extractText(input.fileBuffer, input.mimeType, {
        languageHint: preOcrLanguageHint
      });
      ocrProvider = ocrResult.provider || this.ocrProvider.name;
      ocrBlocks = ocrResult.blocks ?? [];
      ocrPageImages = ocrResult.pageImages ?? [];
      if (ocrResult.tokenUsage?.totalTokens) ocrTokensUsed += ocrResult.tokenUsage.totalTokens;
      const rawText = ocrResult.text.trim();
      rawTextForNormalization = nativePdfText.length > 0 ? nativePdfText : rawText;
      const blockText = buildBlocksText(ocrBlocks);
      const calibrated = calibrateDocumentConfidence(ocrResult.confidence, rawText, blockText);
      ocrConfidence = calibrated.score;
      metadata.docOcrConfidence = formatConfidence(calibrated.score);
      metadata.docLowTokenRatio = formatConfidence(calibrated.lowTokenRatio);
      metadata.docPrintableRatio = formatConfidence(calibrated.printableRatio);

      if (blockText.length > 0) {
        extractionCandidates.push({
          text: blockText,
          provider: ocrProvider,
          confidence: ocrConfidence,
          source: "ocr-blocks"
        });
      }

      const keyValueText = this.enableOcrKeyValueGrounding ? buildKeyValueGroundingText(ocrBlocks) : "";
      if (keyValueText.length > 0 && !isNearDuplicateText(keyValueText, blockText)) {
        extractionCandidates.push({
          text: keyValueText,
          provider: ocrProvider,
          confidence: ocrConfidence,
          source: "ocr-key-value-grounding"
        });
      }
      const augmentedKeyValueText =
        keyValueText.length > 0 ? buildAugmentedGroundingText(keyValueText, blockText, rawText) : "";
      if (
        augmentedKeyValueText.length > 0 &&
        !isNearDuplicateText(augmentedKeyValueText, blockText) &&
        !isNearDuplicateText(augmentedKeyValueText, keyValueText)
      ) {
        extractionCandidates.push({
          text: augmentedKeyValueText,
          provider: ocrProvider,
          confidence: ocrConfidence,
          source: "ocr-key-value-augmented"
        });
      }

      if (rawText.length === 0 && blockText.length === 0) {
        processingIssues.push("OCR provider returned empty text.");
      }

      if (nativePdfText.length > 0) {
        extractionCandidates.push({
          text: nativePdfText,
          provider: "native-pdf-text",
          confidence: ocrConfidence,
          source: "pdf-native-text"
        });
      }
    } catch (error) {
      if (extractionCandidates.length === 0) {
        throw new ExtractionPipelineError(
          "FAILED_OCR",
          error instanceof Error ? error.message : "OCR provider failed to return text."
        );
      }

      processingIssues.push(
        `OCR provider failed; using fallback extracted text. ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (extractionCandidates.length === 0) {
      throw new ExtractionPipelineError("FAILED_OCR", "No text detected from OCR.");
    }

    const postOcrLanguage = detectInvoiceLanguage(extractionCandidates.map((candidate) => candidate.text));
    const detectedLanguage = resolveDetectedLanguage(preOcrLanguage, postOcrLanguage);
    metadata.documentLanguage = detectedLanguage.code;
    metadata.documentLanguageConfidence = formatConfidence(detectedLanguage.confidence);
    metadata.documentLanguageSource = postOcrLanguage.code === "und" ? "pre-ocr" : "post-ocr";
    if (postOcrLanguage.code !== "und") {
      metadata.postOcrLanguage = postOcrLanguage.code;
      metadata.postOcrLanguageConfidence = formatConfidence(postOcrLanguage.confidence);
    }
    if (detectedLanguage.signals.length > 0) {
      metadata.documentLanguageSignals = detectedLanguage.signals.join(",");
    }

    const layoutGraph = buildLayoutGraph(ocrBlocks);
    metadata.layoutGraphNodes = String(layoutGraph.nodes.length);
    metadata.layoutGraphEdges = String(layoutGraph.edges.length);
    metadata.layoutGraphSignature = layoutGraph.signature;

    metadata.ocrGate = "slm-direct";
      const bestText = extractionCandidates[0]?.text ?? "";

      let priorCorrections: Array<{ field: string; hint: string; count: number }> = [];
      if (this.learningStore) {
        try {
          const corrections = await this.learningStore.findCorrections(input.tenantId, template?.vendorName ?? "", fingerprint.key);
          priorCorrections = corrections.map((c) => ({ field: c.field, hint: c.hint, count: c.count }));
        } catch {
          logger.warn("extraction.learning.lookup.skipped", { tenantId: input.tenantId });
        }
      }

      if (priorCorrections.length > 0) {
        logger.info("extraction.learning.hints.provided", {
          tenantId: input.tenantId,
          vendorFingerprint: fingerprint.key,
          hintCount: priorCorrections.length,
          hintFields: priorCorrections.map(c => c.field)
        });
      }

      const deterministicFallback = parseInvoiceText(bestText, { languageHint: detectedLanguage.code });
      const bootstrapFieldCandidates = buildFieldCandidates(bestText, {}, template);
      const bootstrapFieldRegions = buildFieldRegions(ocrBlocks, bootstrapFieldCandidates);

      const slmResult = await this.fieldVerifier.verify({
        parsed: {},
        ocrText: bestText,
        ocrBlocks,
        mode: "relaxed",
        hints: {
          mimeType: input.mimeType,
          languageHint: detectedLanguage.code,
          documentLanguage: detectedLanguage.code,
          vendorTemplateMatched: false,
          fieldCandidates: bootstrapFieldCandidates,
          fieldRegions: bootstrapFieldRegions,
          pageImages: ocrPageImages.slice(0, 3),
          llmAssist: true,
          priorCorrections: this.learningMode === "active" && priorCorrections.length > 0 ? priorCorrections : undefined
        }
      });

      if (slmResult.invoiceType) metadata.invoiceType = slmResult.invoiceType;
      if (slmResult.tokenUsage?.totalTokens) slmTokensUsed += slmResult.tokenUsage.totalTokens;
      const slmParsedRecord = { ...(slmResult.parsed as Record<string, unknown>) };
      const slmBlockIndices: Record<string, number> =
        normalizeBlockIndices(slmParsedRecord._blockIndices) ?? {};
      const verifierFieldConfidence =
        slmResult.fieldConfidence ?? normalizeFieldConfidence(slmParsedRecord._fieldConfidence) ?? {};
      const verifierFieldProvenance =
        slmResult.fieldProvenance ?? normalizeFieldProvenance(slmParsedRecord._fieldProvenance) ?? {};
      const verifierLineItemProvenance =
        slmResult.lineItemProvenance ?? normalizeLineItemProvenance(slmParsedRecord._lineItemProvenance) ?? [];
      const verifierClassification =
        slmResult.classification ?? normalizeClassification(slmParsedRecord._classification);
      delete slmParsedRecord._blockIndices;
      delete slmParsedRecord._fieldConfidence;
      delete slmParsedRecord._fieldProvenance;
      delete slmParsedRecord._lineItemProvenance;
      delete slmParsedRecord._classification;
      const slmParsed = slmParsedRecord as ParsedInvoiceData;
      const slmParsedHasFields = Object.keys(slmParsed).some((key) => {
        const value = (slmParsed as Record<string, unknown>)[key];
        if (Array.isArray(value)) {
          return value.length > 0;
        }
        if (value && typeof value === "object") {
          return Object.keys(value as Record<string, unknown>).length > 0;
        }
        return value !== undefined && value !== null && value !== "";
      });
      const recoveredParsed = slmParsedHasFields ? { ...slmParsed } : { ...deterministicFallback.parsed };
      if (priorCorrections.length > 0) {
        metadata.learningHintsApplied = String(priorCorrections.length);
      }
      if (priorCorrections.length > 0) {
        const hintedFieldResults = priorCorrections.map(c => ({
          field: c.field,
          hintValue: c.hint,
          extractedValue: String((slmParsed as Record<string, unknown>)[c.field] ?? ""),
          matched: c.hint.includes(String((slmParsed as Record<string, unknown>)[c.field] ?? "")) || String((slmParsed as Record<string, unknown>)[c.field] ?? "").includes(c.hint.split(" not ")[0])
        }));
        logger.info("extraction.learning.hints.result", {
          tenantId: input.tenantId,
          vendorFingerprint: fingerprint.key,
          hintCount: priorCorrections.length,
          matchedCount: hintedFieldResults.filter(r => r.matched).length,
          fields: hintedFieldResults
        });
      }
      const slmWarnings = uniqueIssues([
        ...processingIssues,
        ...(slmParsedHasFields ? [] : deterministicFallback.warnings),
        ...slmResult.issues
      ]);
      const slmConfidence = this.assessConfidence(input, recoveredParsed, slmWarnings, ocrConfidence);
      const slmValidation = validateInvoiceFields({
        parsed: recoveredParsed,
        ocrText: bestText,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate
      });

      const recoveryStrategy = classifyOcrRecoveryStrategy(
        ocrBlocks,
        rawTextForNormalization.length > 0 ? rawTextForNormalization : bestText
      );
      const preferredVendorBlock = findPreferredVendorBlockForStrategy(ocrBlocks, recoveryStrategy);
      const slmFieldCandidates = buildFieldCandidates(bestText, recoveredParsed, undefined);
      const slmFieldRegions = buildFieldRegions(ocrBlocks, slmFieldCandidates);
      metadata.extractionSource = "slm-direct";
      metadata.extractionStrategy = recoveryStrategy;
      metadata.lineItemCount = String(
        slmResult.contract?.lineItemCount ??
        (Array.isArray(recoveredParsed.lineItems) ? recoveredParsed.lineItems.length : 0)
      );
      if (!slmValidation.valid) {
        metadata.manualFallback = "required";
        processingIssues.push(...slmValidation.issues);
      }

      const diagnostics = addFieldDiagnosticsToMetadata({
        metadata,
        parsed: recoveredParsed,
        ocrBlocks,
        fieldRegions: slmFieldRegions,
        source: "slm-direct",
        ocrConfidence,
        validationIssues: slmValidation.issues,
        warnings: slmWarnings,
        templateAppliedFields: new Set<string>(),
        verifierChangedFields: Object.keys(slmParsed),
        slmBlockIndices: slmBlockIndices,
        verifierFieldConfidence,
        verifierFieldProvenance
      });
      for (const field of ["invoiceDate", "dueDate"] as const) {
        const fieldValue = recoveredParsed[field];
        if (!fieldValue) {
          continue;
        }
        const matchedDateBlock = selectDateProvenanceBlock(field, fieldValue, ocrBlocks);
        if (!matchedDateBlock) {
          continue;
        }
        const currentProvenance = diagnostics.fieldProvenance[field];
        diagnostics.fieldProvenance[field] = {
          ...currentProvenance,
          page: matchedDateBlock.block.page,
          bbox: matchedDateBlock.block.bbox,
          ...(matchedDateBlock.block.bboxNormalized ? { bboxNormalized: matchedDateBlock.block.bboxNormalized } : {}),
          ...(matchedDateBlock.block.bboxModel ? { bboxModel: matchedDateBlock.block.bboxModel } : {}),
          blockIndex: matchedDateBlock.index
        };
      }
      const invoiceNumberBlock = selectInvoiceNumberProvenanceBlock(recoveredParsed.invoiceNumber, ocrBlocks);
      if (invoiceNumberBlock && recoveredParsed.invoiceNumber) {
        diagnostics.fieldProvenance.invoiceNumber = {
          ...diagnostics.fieldProvenance.invoiceNumber,
          page: invoiceNumberBlock.block.page,
          bbox: invoiceNumberBlock.block.bbox,
          ...(invoiceNumberBlock.block.bboxNormalized ? { bboxNormalized: invoiceNumberBlock.block.bboxNormalized } : {}),
          ...(invoiceNumberBlock.block.bboxModel ? { bboxModel: invoiceNumberBlock.block.bboxModel } : {}),
          blockIndex: invoiceNumberBlock.index
        };
      }
      if (preferredVendorBlock && recoveredParsed.vendorName) {
        diagnostics.fieldProvenance.vendorName = {
          ...diagnostics.fieldProvenance.vendorName,
          page: preferredVendorBlock.block.page,
          bbox: preferredVendorBlock.block.bbox,
          ...(preferredVendorBlock.block.bboxNormalized ? { bboxNormalized: preferredVendorBlock.block.bboxNormalized } : {}),
          ...(preferredVendorBlock.block.bboxModel ? { bboxModel: preferredVendorBlock.block.bboxModel } : {}),
          blockIndex: preferredVendorBlock.index
        };
      }
      const preferredTotalAmountBlock = findPreferredTotalAmountBlockForStrategy(
        ocrBlocks,
        recoveryStrategy,
        recoveredParsed.totalAmountMinor
      );
      if (preferredTotalAmountBlock && diagnostics.fieldProvenance.totalAmountMinor) {
        diagnostics.fieldProvenance.totalAmountMinor = {
          ...diagnostics.fieldProvenance.totalAmountMinor,
          page: preferredTotalAmountBlock.block.page,
          bbox: preferredTotalAmountBlock.block.bbox,
          ...(preferredTotalAmountBlock.block.bboxNormalized ? { bboxNormalized: preferredTotalAmountBlock.block.bboxNormalized } : {}),
          ...(preferredTotalAmountBlock.block.bboxModel ? { bboxModel: preferredTotalAmountBlock.block.bboxModel } : {}),
          blockIndex: preferredTotalAmountBlock.index
        };
      }
      metadata.fieldProvenance = JSON.stringify(diagnostics.fieldProvenance);
      const lineItemProvenance = resolveLineItemProvenance({
        lineItems: recoveredParsed.lineItems,
        ocrBlocks,
        verifierLineItemProvenance
      });
      const lineItemConfidence = collectLineItemConfidence(lineItemProvenance);
      if (Object.keys(lineItemConfidence).length > 0) {
        Object.assign(diagnostics.fieldConfidence, lineItemConfidence);
        metadata.fieldConfidence = JSON.stringify(diagnostics.fieldConfidence);
      }
      if (lineItemProvenance.length > 0) {
        metadata.lineItemProvenance = JSON.stringify(lineItemProvenance);
      }

      let complianceData: import("../../types/invoice.js").InvoiceCompliance | undefined;
      if (this.complianceEnricher) {
        try {
          const complianceResult = await this.complianceEnricher.enrich(recoveredParsed, input.tenantId, fingerprint.key, {
            emailFrom: metadata.from ?? undefined,
            contentHash: fingerprint.hash
          });
          if (complianceResult.riskSignals && complianceResult.riskSignals.length > 0 || complianceResult.pan || complianceResult.tds || complianceResult.tcs || complianceResult.glCode || complianceResult.vendorBank) {
            complianceData = {};
            if (complianceResult.pan) complianceData.pan = complianceResult.pan;
            if (complianceResult.tds) complianceData.tds = complianceResult.tds;
            if (complianceResult.tcs) complianceData.tcs = complianceResult.tcs;
            if (complianceResult.glCode) complianceData.glCode = complianceResult.glCode;
            if (complianceResult.costCenter) complianceData.costCenter = complianceResult.costCenter;
            if (complianceResult.irn) complianceData.irn = complianceResult.irn;
            if (complianceResult.msme) complianceData.msme = complianceResult.msme;
            if (complianceResult.vendorBank) complianceData.vendorBank = complianceResult.vendorBank;
            if (complianceResult.riskSignals && complianceResult.riskSignals.length > 0) complianceData.riskSignals = complianceResult.riskSignals;
          }
        } catch (error) {
          processingIssues.push(`Compliance enrichment failed: ${error instanceof Error ? error.message : String(error)}`);
          logger.warn("compliance.enrichment.failed", {
            tenantId: input.tenantId,
            vendorFingerprint: fingerprint.key,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      let finalConfidence = slmConfidence;
      if (complianceData?.riskSignals && complianceData.riskSignals.length > 0) {
        const compliancePenalty = RiskSignalEvaluator.sumPenalties(complianceData.riskSignals);
        if (compliancePenalty > 0) {
          finalConfidence = this.assessConfidenceWithPenalty(input, recoveredParsed, slmWarnings, ocrConfidence, compliancePenalty);
        }
      }

      const extractionClassification = mergeClassification(
        verifierClassification ?? (slmResult.invoiceType ? { invoiceType: slmResult.invoiceType } : undefined),
        complianceData?.tds?.section
      );
      const extractionData: InvoiceExtractionData = {
        source: "slm-direct",
        strategy: "slm-direct",
        ...(slmResult.invoiceType ? { invoiceType: slmResult.invoiceType } : {}),
        ...(Object.keys(diagnostics.fieldConfidence).length > 0 ? { fieldConfidence: diagnostics.fieldConfidence } : {}),
        ...(Object.keys(diagnostics.fieldProvenance).length > 0 ? { fieldProvenance: diagnostics.fieldProvenance } : {}),
        ...(lineItemProvenance.length > 0 ? { lineItemProvenance } : {}),
        ...(extractionClassification ? { classification: extractionClassification } : {})
      };

      return {
        provider: ocrProvider,
        text: bestText,
        confidence: ocrConfidence,
        source: "slm-direct",
        strategy: "slm-direct",
        parseResult: { parsed: recoveredParsed, warnings: slmWarnings },
        confidenceAssessment: finalConfidence,
        attempts: [],
        ocrBlocks,
        ocrPageImages,
        processingIssues: uniqueIssues(processingIssues),
        metadata,
        ocrTokens: ocrTokensUsed,
        slmTokens: slmTokensUsed,
        compliance: complianceData,
        extraction: extractionData
      };
  }

  private assessConfidence(
    input: ExtractionPipelineInput,
    parsed: ParsedInvoiceData,
    warnings: string[],
    ocrConfidence?: number
  ): ConfidenceAssessment {
    return assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      autoSelectMin: input.autoSelectMin,
      referenceDate: input.referenceDate
    });
  }

  private assessConfidenceWithPenalty(
    input: ExtractionPipelineInput,
    parsed: ParsedInvoiceData,
    warnings: string[],
    ocrConfidence: number | undefined,
    complianceRiskPenalty: number
  ): ConfidenceAssessment {
    return assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      autoSelectMin: input.autoSelectMin,
      referenceDate: input.referenceDate,
      complianceRiskPenalty
    });
  }

  private async cacheTemplate(
    input: ExtractionPipelineInput,
    fingerprintKey: string,
    layoutSignature: string,
    parsed: ParsedInvoiceData,
    confidence: ConfidenceAssessment
  ): Promise<void> {
    if (confidence.score < input.autoSelectMin) {
      return;
    }

    const template = templateFromParsed(
      input.tenantId,
      fingerprintKey,
      layoutSignature,
      parsed,
      confidence.score
    );
    if (!template) {
      return;
    }

    await this.templateStore.saveOrUpdate(template);
    logger.info("vendor.template.cached", {
      tenantId: input.tenantId,
      fingerprintKey,
      vendorName: template.vendorName,
      confidenceScore: confidence.score
    });
  }
}
