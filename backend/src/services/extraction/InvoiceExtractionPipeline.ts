import type { FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { ExtractedField, OcrBlock, OcrPageImage, OcrProvider, OcrResult } from "../../core/interfaces/OcrProvider.js";
import { postProcessOcrResult, type EnhancedOcrResult } from "../../ocr/ocrPostProcessor.js";
import { parseInvoiceText } from "../../parser/invoiceParser.js";
import type {
  InvoiceExtractionData,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "../../types/invoice.js";
import { logger } from "../../utils/logger.js";
import { assessInvoiceConfidence } from "../confidenceAssessment.js";
import type { ComplianceEnricher } from "../compliance/ComplianceEnricher.js";
import { RiskSignalEvaluator } from "../compliance/RiskSignalEvaluator.js";
import type { ExtractionLearningStore } from "./extractionLearningStore.js";
import type { ExtractionMappingService } from "./extractionMappingService.js";
import type { DetectedInvoiceLanguage } from "./languageDetection.js";
import { detectInvoiceLanguage, detectInvoiceLanguageBeforeOcr } from "./languageDetection.js";
import type { PipelineExtractionResult } from "./types.js";
import type { VendorTemplateSnapshot, VendorTemplateStore } from "./vendorTemplateStore.js";
import { validateInvoiceFields } from "./deterministicValidation.js";
import {
  clampProbability,
  formatConfidence,
  resolveDetectedLanguage,
  resolvePreOcrLanguageHint,
  uniqueIssues
} from "./invoiceExtractionPipelineHelpers.js";
import { addFieldDiagnosticsToMetadata, calibrateDocumentConfidence } from "./pipeline/diagnostics.js";
import { buildFieldCandidates, buildFieldRegions } from "./pipeline/fieldCandidates.js";
import {
  buildRankedOcrTextCandidates,
  type RankedOcrTextCandidate
} from "./pipeline/ocrTextCandidates.js";
import { classifyOcrRecoveryStrategy, recoverParsedFromOcr } from "./pipeline/ocrRecovery.js";
import {
  collectLineItemConfidence,
  mergeClassification,
  normalizeClassification,
  normalizeFieldConfidence,
  normalizeFieldProvenance,
  normalizeLineItemProvenance,
  resolveLineItemProvenance
} from "./pipeline/provenance.js";
import { computeVendorFingerprint } from "./vendorFingerprint.js";
import * as fs from "fs/promises";
import * as path from "path";

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
}

interface OcrStageResult {
  enhanced: EnhancedOcrResult;
  primaryCandidate: RankedOcrTextCandidate;
  rankedCandidates: RankedOcrTextCandidate[];
  augmentedText: string;
  ocrBlocks: OcrBlock[];
  ocrPageImages: OcrPageImage[];
  ocrConfidence: number;
  ocrTokens: number;
  preOcrLanguage: DetectedInvoiceLanguage;
  extractFields?: ExtractedField[];
}

interface LanguageResolution {
  preOcr: DetectedInvoiceLanguage;
  postOcr: DetectedInvoiceLanguage;
  resolved: DetectedInvoiceLanguage;
}

interface SlmStageResult {
  parsed: ParsedInvoiceData;
  tokens: number;
  issues: string[];
  changedFields: string[];
  fieldConfidence?: Record<string, number>;
  fieldProvenance?: Record<string, InvoiceFieldProvenance>;
  lineItemProvenance: InvoiceLineItemProvenance[];
  classification?: InvoiceExtractionData["classification"];
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

    const ocr = await this.runOcrStage(input, metadata);
    const language = this.resolveLanguage(ocr, metadata);

    if ((ocr.extractFields?.length ?? 0) > 0) {
      return this.runExtractFieldsPath(input, ocr, processingIssues, metadata, fingerprint);
    }

    const baseline = parseInvoiceText(ocr.primaryCandidate.text, { languageHint: language.resolved.code });
    const fieldCandidates = buildFieldCandidates(ocr.primaryCandidate.text, baseline.parsed, template);
    const fieldRegions = buildFieldRegions(ocr.ocrBlocks, fieldCandidates);

    metadata.baselineFieldCount = String(Object.keys(baseline.parsed).length);
    metadata.baselineWarningCount = String(baseline.warnings.length);
    metadata.fieldCandidateCount = String(Object.keys(fieldCandidates).length);
    metadata.fieldRegionCount = String(Object.keys(fieldRegions).length);

    const slm = await this.runSlmStage({
      input,
      template,
      language,
      ocr,
      baselineParsed: baseline.parsed,
      fieldCandidates,
      fieldRegions
    });
    processingIssues.push(...slm.issues);

    if (Object.keys(slm.parsed).length === 0 && baseline.warnings.length > 0) {
      processingIssues.push(...baseline.warnings);
    }

    const mergedParsed = mergeParsedInvoiceData(baseline.parsed, slm.parsed);
    const parsed = recoverParsedFromOcr(mergedParsed, ocr.ocrBlocks, ocr.primaryCandidate.text);
    const recoveryStrategy = classifyOcrRecoveryStrategy(ocr.ocrBlocks, ocr.primaryCandidate.text);
    metadata.ocrRecoveryStrategy = recoveryStrategy;

    const validation = validateInvoiceFields({
      parsed,
      ocrText: ocr.primaryCandidate.text,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate
    });

    if (!validation.valid) {
      processingIssues.push(...validation.issues);
    }

    const diagnostics = addFieldDiagnosticsToMetadata({
      metadata,
      parsed,
      ocrBlocks: ocr.ocrBlocks,
      fieldRegions,
      source: "slm-direct",
      ocrConfidence: ocr.ocrConfidence,
      validationIssues: validation.issues,
      warnings: processingIssues,
      templateAppliedFields: new Set<string>(),
      verifierChangedFields: slm.changedFields,
      verifierFieldConfidence: slm.fieldConfidence,
      verifierFieldProvenance: slm.fieldProvenance
    });

    const compliance = await this.runCompliance(parsed, input, fingerprint);

    let confidence = this.assessConfidence(input, parsed, processingIssues, ocr.ocrConfidence);

    if (compliance?.riskSignals?.length) {
      const penalty = RiskSignalEvaluator.sumPenalties(compliance.riskSignals);
      confidence = this.assessConfidenceWithPenalty(input, parsed, processingIssues, ocr.ocrConfidence, penalty);
    }

    const lineItemProvenance = resolveLineItemProvenance({
      lineItems: parsed.lineItems,
      ocrBlocks: ocr.ocrBlocks,
      verifierLineItemProvenance: slm.lineItemProvenance
    });
    const lineItemConfidence = collectLineItemConfidence(lineItemProvenance);
    const combinedFieldConfidence =
      Object.keys(lineItemConfidence).length > 0
        ? { ...diagnostics.fieldConfidence, ...lineItemConfidence }
        : diagnostics.fieldConfidence;
    const classification = mergeClassification(slm.classification, compliance?.tds?.section);

    const extraction: InvoiceExtractionData = {
      source: "slm-direct",
      strategy: `slm-${recoveryStrategy}`,
      ...(classification ? { classification } : {}),
      ...(classification?.invoiceType ? { invoiceType: classification.invoiceType } : {}),
      ...(Object.keys(combinedFieldConfidence).length > 0 ? { fieldConfidence: combinedFieldConfidence } : {}),
      ...(Object.keys(diagnostics.fieldProvenance).length > 0 ? { fieldProvenance: diagnostics.fieldProvenance } : {}),
      ...(lineItemProvenance.length > 0 ? { lineItemProvenance } : {})
    };

    return {
      provider: this.ocrProvider.name,
      text: ocr.primaryCandidate.text,
      confidence: ocr.ocrConfidence,
      source: "slm-direct",
      strategy: extraction.strategy ?? "slm-direct",
      parseResult: { parsed, warnings: processingIssues },
      confidenceAssessment: confidence,
      attempts: [],
      ocrBlocks: ocr.ocrBlocks,
      ocrPageImages: ocr.ocrPageImages,
      processingIssues: uniqueIssues(processingIssues),
      metadata,
      ocrTokens: ocr.ocrTokens,
      slmTokens: slm.tokens,
      compliance,
      extraction
    };
  }


  private async runExtractFieldsPath(
    input: ExtractionPipelineInput,
    ocr: OcrStageResult,
    processingIssues: string[],
    metadata: Record<string, string>,
    fingerprint: ReturnType<typeof computeVendorFingerprint>
  ): Promise<PipelineExtractionResult> {
    const fields = ocr.extractFields!;
    const fieldMap = new Map<string, ExtractedField>(fields.map((f) => [f.key, f]));

    const parsed: ParsedInvoiceData = {};

    const getString = (key: string): string | undefined => {
      const f = fieldMap.get(key);
      if (!f) return undefined;
      if (typeof f.value !== "string" || f.value.trim() === "") return undefined;
      return f.value.trim();
    };

    const getNumber = (key: string): number | undefined => {
      const f = fieldMap.get(key);
      if (!f) return undefined;
      if (typeof f.value !== "number" || f.value === null) return undefined;
      return f.value;
    };

    const invoiceNumber = getString("invoice_number");
    if (invoiceNumber) parsed.invoiceNumber = invoiceNumber;

    const vendorName = getString("vendor_name");
    if (vendorName) parsed.vendorName = vendorName;

    const invoiceDate = getString("invoice_date");
    if (invoiceDate) parsed.invoiceDate = invoiceDate;

    const dueDate = getString("due_date");
    if (dueDate) parsed.dueDate = dueDate;

    const currency = getString("currency");
    if (currency) parsed.currency = currency;

    const totalAmountRaw = getNumber("total_amount");
    if (totalAmountRaw !== undefined) parsed.totalAmountMinor = Math.round(totalAmountRaw * 100);

    const pan = getString("pan");
    if (pan) parsed.pan = pan;

    const subtotalRaw = getNumber("subtotal");
    const cgstRaw = getNumber("cgst_amount");
    const sgstRaw = getNumber("sgst_amount");
    const igstRaw = getNumber("igst_amount");
    const cessRaw = getNumber("cess_amount");
    const gstin = getString("gstin");

    const totalTaxRaw = (cgstRaw ?? 0) + (sgstRaw ?? 0) + (igstRaw ?? 0) + (cessRaw ?? 0);
    const hasGst = subtotalRaw !== undefined || cgstRaw !== undefined || sgstRaw !== undefined || igstRaw !== undefined || cessRaw !== undefined || gstin !== undefined;

    if (hasGst) {
      const gst: NonNullable<ParsedInvoiceData["gst"]> = {};
      if (subtotalRaw !== undefined) gst.subtotalMinor = Math.round(subtotalRaw * 100);
      if (cgstRaw !== undefined) gst.cgstMinor = Math.round(cgstRaw * 100);
      if (sgstRaw !== undefined) gst.sgstMinor = Math.round(sgstRaw * 100);
      if (igstRaw !== undefined) gst.igstMinor = Math.round(igstRaw * 100);
      if (cessRaw !== undefined) gst.cessMinor = Math.round(cessRaw * 100);
      if (totalTaxRaw > 0) gst.totalTaxMinor = Math.round(totalTaxRaw * 100);
      if (gstin !== undefined) gst.gstin = gstin;
      parsed.gst = gst;
    }

    const provenanceKeyMap: Record<string, string> = {
      invoice_number: "invoiceNumber",
      vendor_name: "vendorName",
      invoice_date: "invoiceDate",
      due_date: "dueDate",
      currency: "currency",
      total_amount: "totalAmountMinor",
      cgst_amount: "gst.cgstMinor",
      sgst_amount: "gst.sgstMinor",
      igst_amount: "gst.igstMinor",
      cess_amount: "gst.cessMinor",
      gstin: "gst.gstin",
      pan: "pan"
    };

    const fieldProvenance: Record<string, InvoiceFieldProvenance> = {};
    for (const field of fields) {
      const mappedKey = provenanceKeyMap[field.key];
      if (!mappedKey) continue;
      if (field.page === undefined && field.bbox === undefined) continue;
      const entry: InvoiceFieldProvenance = { source: "llamaextract" };
      if (field.page !== undefined) entry.page = field.page;
      if (field.bbox !== undefined) entry.bbox = field.bbox;
      if (field.bboxNormalized !== undefined) entry.bboxNormalized = field.bboxNormalized;
      if (field.confidence !== undefined) entry.confidence = field.confidence;
      fieldProvenance[mappedKey] = entry;
    }

    const validation = validateInvoiceFields({
      parsed,
      ocrText: ocr.primaryCandidate.text,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate
    });
    if (!validation.valid) {
      processingIssues.push(...validation.issues);
    }

    const compliance = await this.runCompliance(parsed, input, fingerprint);

    let confidence = this.assessConfidence(input, parsed, processingIssues, ocr.ocrConfidence);
    if (compliance?.riskSignals?.length) {
      const penalty = RiskSignalEvaluator.sumPenalties(compliance.riskSignals);
      confidence = this.assessConfidenceWithPenalty(input, parsed, processingIssues, ocr.ocrConfidence, penalty);
    }

    const extraction: InvoiceExtractionData = {
      source: "llamaextract",
      strategy: "llamaextract",
      ...(Object.keys(fieldProvenance).length > 0 ? { fieldProvenance } : {})
    };

    return {
      provider: this.ocrProvider.name,
      text: ocr.primaryCandidate.text,
      confidence: ocr.ocrConfidence,
      source: "llamaextract",
      strategy: "llamaextract",
      parseResult: { parsed, warnings: processingIssues },
      confidenceAssessment: confidence,
      attempts: [],
      ocrBlocks: ocr.ocrBlocks,
      ocrPageImages: ocr.ocrPageImages,
      processingIssues: uniqueIssues(processingIssues),
      metadata,
      ocrTokens: ocr.ocrTokens,
      slmTokens: 0,
      compliance,
      extraction
    };
  }

  private async runOcrStage(input: ExtractionPipelineInput, metadata: Record<string, string>): Promise<OcrStageResult> {
    const preOcrLanguage = detectInvoiceLanguageBeforeOcr(input);
    const preOcrLanguageHint = resolvePreOcrLanguageHint(preOcrLanguage, input.mimeType);
    metadata.preOcrLanguage = preOcrLanguage.code;
    metadata.preOcrLanguageConfidence = formatConfidence(preOcrLanguage.confidence);
    metadata.preOcrLanguageHintReason = preOcrLanguageHint.reason;
    if (preOcrLanguageHint.hint) {
      metadata.preOcrLanguageHint = preOcrLanguageHint.hint;
    }

    const result = await this.ocrProvider.extractText(input.fileBuffer, input.mimeType, {
      languageHint: preOcrLanguageHint.hint
    });
    const enhanced = postProcessOcrResult(result);

    if (this.ocrDumpEnabled) {
      await this.saveOcrResult(result, enhanced);
    }

    const rawText = result.text.trim();
    const textCandidates = buildRankedOcrTextCandidates({
      rawText,
      blocks: result.blocks ?? [],
      layoutLines: enhanced.lines,
      enableKeyValueGrounding: this.enableOcrKeyValueGrounding
    });
    const primary = textCandidates.primary.text;

    if (!primary) throw new ExtractionPipelineError("FAILED_OCR", "Empty OCR");

    const calibrated = calibrateDocumentConfidence(result.confidence, rawText, primary);
    metadata.ocrPrimaryVariant = textCandidates.primary.id;
    metadata.ocrPrimaryVariantScore = textCandidates.primary.score.toFixed(3);
    metadata.ocrPrimaryTokenCount = String(textCandidates.primary.metrics.tokenCount);
    metadata.ocrCandidateCount = String(textCandidates.ranked.length);
    metadata.ocrHasKeyValueGrounding = textCandidates.keyValueText.length > 0 ? "true" : "false";
    metadata.ocrHasAugmentedContext = textCandidates.augmentedText.length > 0 ? "true" : "false";
    metadata.ocrLowQualityTokenRatio = formatConfidence(textCandidates.primary.metrics.lowQualityTokenRatio);
    metadata.ocrDuplicateLineRatio = formatConfidence(textCandidates.primary.metrics.duplicateLineRatio);

    return {
      enhanced,
      primaryCandidate: textCandidates.primary,
      rankedCandidates: textCandidates.ranked,
      augmentedText: textCandidates.augmentedText,
      ocrBlocks: result.blocks ?? [],
      ocrPageImages: result.pageImages ?? [],
      ocrConfidence: calibrated.score,
      ocrTokens: result.tokenUsage?.totalTokens ?? 0,
      preOcrLanguage,
      extractFields: result.fields
    };
  }

  private resolveLanguage(ocr: OcrStageResult, metadata: Record<string, string>): LanguageResolution {
    const post = detectInvoiceLanguage(ocr.rankedCandidates.map((candidate) => candidate.text));
    const resolved = resolveDetectedLanguage(ocr.preOcrLanguage, post);

    metadata.postOcrLanguage = post.code;
    metadata.postOcrLanguageConfidence = formatConfidence(post.confidence);
    metadata.documentLanguage = resolved.code;
    metadata.documentLanguageConfidence = formatConfidence(resolved.confidence);

    return {
      preOcr: ocr.preOcrLanguage,
      postOcr: post,
      resolved
    };
  }

  private async runSlmStage(params: {
    input: ExtractionPipelineInput;
    template: VendorTemplateSnapshot | undefined;
    language: LanguageResolution;
    ocr: OcrStageResult;
    baselineParsed: ParsedInvoiceData;
    fieldCandidates: Record<string, string[]>;
    fieldRegions: Record<string, OcrBlock[]>;
  }): Promise<SlmStageResult> {
    const shouldAttachContext = this.shouldAttachDocumentContext(params.ocr.ocrConfidence, params.fieldCandidates);
    const contextText = shouldAttachContext ? params.ocr.augmentedText || params.ocr.primaryCandidate.text : "";
    const candidateScores = params.ocr.rankedCandidates.slice(0, 4).map((candidate) => ({
      id: candidate.id,
      score: candidate.score
    }));

    try {
      const res = await this.fieldVerifier.verify({
        parsed: params.baselineParsed,
        ocrText: params.ocr.primaryCandidate.text,
        ocrBlocks: params.ocr.ocrBlocks,
        mode: "relaxed",
        hints: {
          mimeType: params.input.mimeType,
          languageHint: params.language.resolved.code !== "und" ? params.language.resolved.code : undefined,
          documentLanguage: params.language.resolved.code,
          documentLanguageConfidence: params.language.resolved.confidence,
          preOcrLanguage: params.language.preOcr.code,
          preOcrLanguageConfidence: params.language.preOcr.confidence,
          postOcrLanguage: params.language.postOcr.code,
          postOcrLanguageConfidence: params.language.postOcr.confidence,
          vendorNameHint: params.template?.vendorName,
          vendorTemplateMatched: Boolean(params.template),
          fieldCandidates: params.fieldCandidates,
          fieldRegions: params.fieldRegions,
          pageImages: params.ocr.ocrPageImages.slice(0, 3),
          llmAssist: params.ocr.ocrConfidence * 100 < this.llmAssistConfidenceThreshold,
          extractionMode: this.learningMode,
          mergedBlocks: params.ocr.enhanced.mergedBlocks,
          structuredLines: params.ocr.enhanced.lines,
          structuredTables: params.ocr.enhanced.tables,
          normalizedAmounts: params.ocr.enhanced.normalized.amounts,
          normalizedDates: params.ocr.enhanced.normalized.dates,
          normalizedCurrencies: params.ocr.enhanced.normalized.currencies,
          documentContext: contextText || undefined,
          fileName: params.input.attachmentName,
          attachmentName: params.input.attachmentName,
          ocrTextVariant: params.ocr.primaryCandidate.id,
          ocrCandidateScores: candidateScores
        }
      });

      const normalizedParsed = sanitizeParsedInvoiceData(res.parsed);
      const parsed = Object.keys(normalizedParsed).length > 0 ? normalizedParsed : params.baselineParsed;
      const classification = normalizeClassification(
        res.classification ?? (res.invoiceType ? { invoiceType: res.invoiceType } : undefined)
      );
      return {
        parsed,
        tokens: res.tokenUsage?.totalTokens ?? 0,
        issues: uniqueIssues(res.issues ?? []),
        changedFields: uniqueIssues(res.changedFields ?? []),
        fieldConfidence: normalizeFieldConfidence(res.fieldConfidence),
        fieldProvenance: normalizeFieldProvenance(res.fieldProvenance),
        lineItemProvenance: normalizeLineItemProvenance(res.lineItemProvenance) ?? [],
        classification
      };
    } catch (error) {
      logger.warn("extraction.pipeline.slm.failed", {
        provider: this.fieldVerifier.name,
        error: toErrorMessage(error)
      });
      return {
        parsed: params.baselineParsed,
        tokens: 0,
        issues: ["SLM verification failed. Falling back to OCR heuristics."],
        changedFields: [],
        lineItemProvenance: []
      };
    }
  }

  private shouldAttachDocumentContext(
    ocrConfidence: number,
    fieldCandidates: Record<string, string[]>
  ): boolean {
    if (ocrConfidence < this.ocrHighConfidenceThreshold) {
      return true;
    }

    return Object.values(fieldCandidates).some((candidates) => candidates.length > 1);
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
    } catch {
      return;
    }
  }

  private assessConfidence(input: ExtractionPipelineInput, parsed: ParsedInvoiceData, warnings: string[], ocrConfidence?: number) {
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
  const baseNormalized = sanitizeParsedInvoiceData(base);
  const overrideNormalized = sanitizeParsedInvoiceData(override);
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

  return sanitizeParsedInvoiceData(merged);
}

function sanitizeParsedInvoiceData(parsed: ParsedInvoiceData | undefined): ParsedInvoiceData {
  if (!parsed) {
    return {};
  }

  const normalized: ParsedInvoiceData = {};
  const copyString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const invoiceNumber = copyString(parsed.invoiceNumber);
  if (invoiceNumber) {
    normalized.invoiceNumber = invoiceNumber;
  }
  const vendorName = copyString(parsed.vendorName);
  if (vendorName) {
    normalized.vendorName = vendorName;
  }
  const invoiceDate = copyString(parsed.invoiceDate);
  if (invoiceDate) {
    normalized.invoiceDate = invoiceDate;
  }
  const dueDate = copyString(parsed.dueDate);
  if (dueDate) {
    normalized.dueDate = dueDate;
  }
  const currency = copyString(parsed.currency);
  if (currency) {
    normalized.currency = currency.toUpperCase();
  }
  if (Number.isInteger(parsed.totalAmountMinor) && (parsed.totalAmountMinor ?? 0) > 0) {
    normalized.totalAmountMinor = parsed.totalAmountMinor;
  }

  const notes = uniqueIssues(parsed.notes ?? []);
  if (notes.length > 0) {
    normalized.notes = notes;
  }

  const gst = parsed.gst;
  if (gst) {
    const normalizedGst: NonNullable<ParsedInvoiceData["gst"]> = {};
    if (copyString(gst.gstin)) {
      normalizedGst.gstin = gst.gstin?.trim();
    }
    for (const field of [
      "subtotalMinor",
      "cgstMinor",
      "sgstMinor",
      "igstMinor",
      "cessMinor",
      "totalTaxMinor"
    ] as const) {
      const value = gst[field];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        normalizedGst[field] = value;
      }
    }
    if (Object.keys(normalizedGst).length > 0) {
      normalized.gst = normalizedGst;
    }
  }

  if (Array.isArray(parsed.lineItems)) {
    const lineItems = parsed.lineItems
      .map((item) => {
        const description = copyString(item.description) ?? "";
        if (!Number.isInteger(item.amountMinor) || item.amountMinor <= 0) {
          return undefined;
        }
        return {
          ...item,
          description
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (lineItems.length > 0) {
      normalized.lineItems = lineItems;
    }
  }

  const pan = copyString(parsed.pan);
  if (pan) {
    normalized.pan = pan.toUpperCase();
  }
  const bankAccountNumber = copyString(parsed.bankAccountNumber);
  if (bankAccountNumber) {
    normalized.bankAccountNumber = bankAccountNumber;
  }
  const bankIfsc = copyString(parsed.bankIfsc);
  if (bankIfsc) {
    normalized.bankIfsc = bankIfsc.toUpperCase();
  }

  return normalized;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
