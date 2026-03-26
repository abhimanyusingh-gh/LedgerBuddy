import type { FieldVerificationMode, FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrPageImage, OcrProvider } from "../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../types/invoice.js";
import { assessInvoiceConfidence, type ConfidenceAssessment } from "../confidenceAssessment.js";
import { buildLayoutGraph } from "./layoutGraph.js";
import { validateInvoiceFields } from "./deterministicValidation.js";
import { computeVendorFingerprint } from "./vendorFingerprint.js";
import { templateFromParsed, type VendorTemplateSnapshot, type VendorTemplateStore } from "./vendorTemplateStore.js";
import { buildCorrectionHint, type CorrectionEntry, type ExtractionLearningStore } from "./extractionLearningStore.js";
import type { PipelineExtractionResult } from "./types.js";
import { logger } from "../../utils/logger.js";
import { detectInvoiceLanguage, detectInvoiceLanguageBeforeOcr, type DetectedInvoiceLanguage } from "./languageDetection.js";
import { currencyBySymbol, parseAmountToken } from "../../parser/invoiceParser.js";

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

  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly fieldVerifier: FieldVerifier,
    private readonly templateStore: VendorTemplateStore,
    private readonly learningStore: ExtractionLearningStore | undefined,
    options?: ExtractionPipelineOptions
  ) {
    this.ocrHighConfidenceThreshold = clampProbability(options?.ocrHighConfidenceThreshold ?? 0.88);
    this.enableOcrKeyValueGrounding = options?.enableOcrKeyValueGrounding ?? true;
    this.llmAssistConfidenceThreshold = options?.llmAssistConfidenceThreshold ?? 85;
    this.verifierTimeoutMs = 60_000;
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
      const slmResult = await this.fieldVerifier.verify({
        parsed: {} as ParsedInvoiceData,
        ocrText: bestText,
        ocrBlocks,
        mode: "relaxed",
        hints: {
          mimeType: input.mimeType,
          languageHint: detectedLanguage.code,
          documentLanguage: detectedLanguage.code,
          vendorTemplateMatched: false,
          fieldCandidates: {},
          pageImages: ocrPageImages.slice(0, 3),
          llmAssist: true
        }
      });

      if (slmResult.tokenUsage?.totalTokens) slmTokensUsed += slmResult.tokenUsage.totalTokens;
      const slmBlockIndices: Record<string, number> = (slmResult.parsed as Record<string, unknown>)._blockIndices as Record<string, number> ?? {};
      const slmParsed = { ...slmResult.parsed };
      delete (slmParsed as Record<string, unknown>)._blockIndices;
      const slmWarnings = uniqueIssues([...processingIssues, ...slmResult.issues]);
      const slmConfidence = this.assessConfidence(input, slmParsed, slmWarnings, ocrConfidence);
      const slmValidation = validateInvoiceFields({
        parsed: slmParsed,
        ocrText: bestText,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate
      });

      const slmFieldCandidates = buildFieldCandidates(bestText, slmParsed, undefined);
      const slmFieldRegions = buildFieldRegions(ocrBlocks, slmFieldCandidates);
      metadata.extractionSource = "slm-direct";
      metadata.extractionStrategy = "slm-direct";
      if (!slmValidation.valid) {
        metadata.manualFallback = "required";
        processingIssues.push(...slmValidation.issues);
      }

      addFieldDiagnosticsToMetadata({
        metadata,
        parsed: slmParsed,
        ocrBlocks,
        fieldRegions: slmFieldRegions,
        source: "slm-direct",
        ocrConfidence,
        validationIssues: slmValidation.issues,
        warnings: slmWarnings,
        templateAppliedFields: new Set<string>(),
        verifierChangedFields: Object.keys(slmParsed),
        slmBlockIndices: slmBlockIndices
      });

      return {
        provider: ocrProvider,
        text: bestText,
        confidence: ocrConfidence,
        source: "slm-direct",
        strategy: "slm-direct",
        parseResult: { parsed: slmParsed, warnings: slmWarnings },
        confidenceAssessment: slmConfidence,
        attempts: [],
        ocrBlocks,
        ocrPageImages,
        processingIssues: uniqueIssues(processingIssues),
        metadata,
        ocrTokens: ocrTokensUsed,
        slmTokens: slmTokensUsed
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

function applyTemplate(template: VendorTemplateSnapshot, parsed: ParsedInvoiceData): ParsedInvoiceData {
  const next: ParsedInvoiceData = { ...parsed };
  if (!next.vendorName || isWeakVendorValue(next.vendorName)) {
    next.vendorName = template.vendorName;
  }
  if (!next.currency && template.currency) {
    next.currency = template.currency;
  }
  if (template.invoicePrefix && next.invoiceNumber && !next.invoiceNumber.toUpperCase().startsWith(template.invoicePrefix)) {
    next.invoiceNumber = `${template.invoicePrefix}-${next.invoiceNumber}`;
  }
  return next;
}

function mergeParsedWithVerification(
  parsed: ParsedInvoiceData,
  verified: ParsedInvoiceData,
  mode: FieldVerificationMode
): ParsedInvoiceData {
  const merged: ParsedInvoiceData = { ...parsed };
  const candidates: Array<keyof ParsedInvoiceData> = [
    "invoiceNumber",
    "vendorName",
    "invoiceDate",
    "dueDate",
    "currency",
    "totalAmountMinor",
    "notes"
  ];

  for (const field of candidates) {
    const candidateValue = verified[field];
    if (candidateValue === undefined) {
      continue;
    }

    if (mode === "relaxed") {
      assignParsedField(merged, field, candidateValue);
      continue;
    }

    const currentValue = merged[field];
    if (currentValue === undefined) {
      assignParsedField(merged, field, candidateValue);
      continue;
    }

    if (field === "vendorName" && typeof currentValue === "string" && typeof candidateValue === "string") {
      if (looksLikeAddress(currentValue) && !looksLikeAddress(candidateValue)) {
        merged.vendorName = candidateValue;
      }
    }

    if (field === "totalAmountMinor" && typeof currentValue === "number" && typeof candidateValue === "number") {
      if (currentValue <= 0 && candidateValue > 0) {
        merged.totalAmountMinor = candidateValue;
      } else if (candidateValue > 0 && candidateValue !== currentValue) {
        merged.totalAmountMinor = candidateValue;
      }
    }

    if (field === "invoiceDate" && typeof currentValue === "string" && typeof candidateValue === "string") {
      if (candidateValue !== currentValue) {
        assignParsedField(merged, field, candidateValue);
      }
    }

    if (field === "dueDate" && typeof currentValue === "string" && typeof candidateValue === "string") {
      if (candidateValue !== currentValue) {
        assignParsedField(merged, field, candidateValue);
      }
    }

    if (field === "currency" && typeof currentValue === "string" && typeof candidateValue === "string") {
      if (candidateValue !== currentValue) {
        assignParsedField(merged, field, candidateValue);
      }
    }

    if (field === "invoiceNumber" && typeof currentValue === "string" && typeof candidateValue === "string") {
      if (candidateValue.length > currentValue.length) {
        assignParsedField(merged, field, candidateValue);
      }
    }
  }

  return merged;
}

function assignParsedField<K extends keyof ParsedInvoiceData>(
  target: ParsedInvoiceData,
  field: K,
  value: ParsedInvoiceData[K]
): void {
  target[field] = value;
}

function detectChangedFields(before: ParsedInvoiceData, after: ParsedInvoiceData): string[] {
  const changed: string[] = [];
  for (const key of Object.keys(after) as Array<keyof ParsedInvoiceData>) {
    if (!isSameValue(before[key], after[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function isSameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const a = Array.isArray(left) ? left : [];
    const b = Array.isArray(right) ? right : [];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  return left === right;
}

const ADDRESS_RE = /\b(address|warehouse|village|road|street|taluk|district|postal|zip)\b/i;
const WEAK_VENDOR_RE = /\b(currency|invoice|total|amount|date|due|tax|gst|vat|number)\b/i;

function detectAmountMismatch(parsed: ParsedInvoiceData, ocrText: string): boolean {
  if (!parsed.totalAmountMinor || parsed.totalAmountMinor <= 0) {
    return false;
  }

  const totalMajor = parsed.totalAmountMinor / 100;
  const lines = ocrText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const subtotalPattern = /\b(sub\s*total|subtotal)\b/i;
  const lineItemAmounts: number[] = [];
  let subtotalValue: number | undefined;

  for (const line of lines) {
    if (subtotalPattern.test(line)) {
      const amounts = line.match(/[\d,]+\.?\d*/g);
      if (amounts) {
        const parsed = amounts.map((a) => Number(a.replace(/,/g, ""))).filter((v) => v > 0 && Number.isFinite(v));
        if (parsed.length > 0) {
          subtotalValue = Math.max(...parsed);
        }
      }
    }
  }

  if (subtotalValue === undefined) {
    return false;
  }

  const gst = parsed.gst;
  const taxSum = gst
    ? ((gst.cgstMinor ?? 0) + (gst.sgstMinor ?? 0) + (gst.igstMinor ?? 0) + (gst.cessMinor ?? 0)) / 100
    : 0;

  if (taxSum > 0) {
    const expectedTotal = subtotalValue + taxSum;
    if (Math.abs(expectedTotal - totalMajor) > 1) {
      return true;
    }
  }

  if (subtotalValue > totalMajor) {
    return true;
  }

  return false;
}

function looksLikeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

function isWeakVendorValue(value: string): boolean {
  return looksLikeAddress(value) || WEAK_VENDOR_RE.test(value);
}

function buildFieldCandidates(
  text: string,
  parsed: ParsedInvoiceData,
  template?: VendorTemplateSnapshot
): Record<string, string[]> {
  const invoiceNumberMatches = uniqueStrings([
    parsed.invoiceNumber,
    ...collectMatches(text, /\b(?:invoice|bill|inv)\s*(?:number|no\.?|#)\s*[:\-]?\s*#?\s*([A-Z0-9][A-Z0-9_\-/]{2,})/gi)
  ]);
  const vendorMatches = uniqueStrings([
    parsed.vendorName,
    template?.vendorName,
    ...collectMatches(
      text,
      /^(?:vendor|supplier|sold\s*by|bill\s*from|from)\s*[:\-]?\s*([A-Za-z0-9&'().,\-\s]{3,})$/gim
    ).map((entry) => entry.split(",")[0].trim())
  ]).filter((entry) => !looksLikeAddress(entry));

  const currencyMatches = uniqueStrings([
    parsed.currency,
    template?.currency,
    ...collectMatches(text, /\b(USD|EUR|GBP|INR|AUD|CAD|JPY|AED|SGD|CHF|CNY)\b/gi).map((entry) =>
      entry.toUpperCase()
    ),
    ...collectMatches(text, /([$€£₹])/g).map((symbol) => currencyBySymbol[symbol] ?? "")
  ]);

  const totalMatches = uniqueStrings([
    parsed.totalAmountMinor !== undefined ? String(parsed.totalAmountMinor) : undefined,
    ...collectMatches(
      text,
      /(?:grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*payable)\s*[:\-]?\s*([-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)(?:[.,]\d{1,2})?)/gi
    ).map((value) => {
      const major = parseAmountToken(value);
      if (major === null || major <= 0) return "";
      return String(Math.round(major * 100));
    })
  ]);

  const candidateMap: Record<string, string[]> = {
    invoiceNumber: invoiceNumberMatches,
    vendorName: vendorMatches,
    currency: currencyMatches,
    totalAmountMinor: totalMatches
  };

  const currentValues: Record<string, string | undefined> = {
    invoiceNumber: parsed.invoiceNumber,
    vendorName: parsed.vendorName,
    currency: parsed.currency,
    totalAmountMinor: parsed.totalAmountMinor !== undefined ? String(parsed.totalAmountMinor) : undefined
  };

  const filtered = Object.fromEntries(
    Object.entries(candidateMap).filter(([field, values]) => values.length > 1 || !currentValues[field])
  );
  return filtered as Record<string, string[]>;
}

function buildFieldRegions(
  blocks: OcrBlock[],
  fieldCandidates: Record<string, string[]>
): Record<string, OcrBlock[]> {
  if (blocks.length === 0) {
    return {};
  }

  const regions: Record<string, OcrBlock[]> = {};
  for (const [field, candidates] of Object.entries(fieldCandidates)) {
    const terms = candidates.flatMap((candidate) => candidateTerms(field, candidate));
    if (terms.length === 0) {
      continue;
    }

    const matches = blocks.filter((block) => {
      const haystack = block.text.trim().toLowerCase();
      if (!haystack) {
        return false;
      }
      return terms.some((term) => term.length > 0 && haystack.includes(term));
    });

    if (matches.length > 0) {
      regions[field] = matches.slice(0, 20);
    }
  }

  return regions;
}

function candidateTerms(field: string, value: string): string[] {
  const base = value.trim().toLowerCase();
  if (!base) {
    return [];
  }

  if (field !== "totalAmountMinor") {
    return [base];
  }

  const amount = Number(base);
  if (!Number.isFinite(amount) || amount <= 0) {
    return [base];
  }

  const withDecimals = amount.toFixed(2);
  const noDecimals = Number.isInteger(amount) ? String(amount) : "";
  const digitsOnly = base.replace(/[^0-9]/g, "");

  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of [base, withDecimals, noDecimals, digitsOnly]) {
    const entry = raw.trim().toLowerCase();
    if (entry.length >= 3 && !seen.has(entry)) {
      seen.add(entry);
      terms.push(entry);
    }
  }
  return terms;
}

function collectMatches(text: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of text.matchAll(pattern)) {
    const value = match[1] ?? match[0];
    if (value && value.trim().length > 0) {
      matches.push(value.trim());
    }
  }
  return matches;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim() ?? "").filter((value) => value.length > 0))];
}

function calibrateDocumentConfidence(
  baseConfidence: number | undefined,
  rawText: string,
  blockText: string
): { score: number; lowTokenRatio: number; printableRatio: number } {
  const sourceText = [rawText, blockText].filter((entry) => entry.length > 0).join("\n");
  if (sourceText.trim().length === 0) {
    return {
      score: 0,
      lowTokenRatio: 1,
      printableRatio: 0
    };
  }

  const tokens = sourceText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const lowTokenCount = tokens.filter((token) => isLowQualityToken(token)).length;
  const lowTokenRatio = tokens.length > 0 ? lowTokenCount / tokens.length : 1;

  const printableCount = [...sourceText].filter((char) => (char >= " " && char <= "~") || char === "\n").length;
  const printableRatio = printableCount / Math.max(1, sourceText.length);
  const base = clampProbability(baseConfidence ?? 0.75);
  const score = clampProbability(base * 0.8 + (1 - lowTokenRatio) * 0.15 + printableRatio * 0.05);

  return {
    score: Number(score.toFixed(4)),
    lowTokenRatio: Number(lowTokenRatio.toFixed(4)),
    printableRatio: Number(printableRatio.toFixed(4))
  };
}

function isLowQualityToken(token: string): boolean {
  if (token.length <= 1) {
    return true;
  }

  const alphaNumCount = [...token].filter((char) => /[a-z0-9]/i.test(char)).length;
  const ratio = alphaNumCount / token.length;
  if (ratio < 0.5) {
    return true;
  }

  if (/([A-Za-z])\1\1/.test(token)) {
    return true;
  }

  return /[^\w.,:/\-₹$€£]/.test(token);
}

function addFieldDiagnosticsToMetadata(params: {
  metadata: Record<string, string>;
  parsed: ParsedInvoiceData;
  ocrBlocks: OcrBlock[];
  fieldRegions: Record<string, OcrBlock[]>;
  source: string;
  ocrConfidence?: number;
  validationIssues: string[];
  warnings: string[];
  templateAppliedFields: Set<string>;
  verifierChangedFields: string[];
  slmBlockIndices?: Record<string, number>;
}): void {
  const fieldNames: Array<keyof ParsedInvoiceData> = [
    "invoiceNumber",
    "vendorName",
    "invoiceDate",
    "dueDate",
    "currency",
    "totalAmountMinor"
  ];

  const ocrConfidence = clampProbability(params.ocrConfidence ?? 0.75);
  const validationText = params.validationIssues.join(" ").toLowerCase();
  const warningText = params.warnings.join(" ").toLowerCase();
  const changedByVerifier = new Set(params.verifierChangedFields);

  const fieldConfidence: Record<string, number> = {};
  const fieldProvenance: Record<
    string,
    {
      source: string;
      page: number;
      bbox?: [number, number, number, number];
      bboxNormalized?: [number, number, number, number];
      bboxModel?: [number, number, number, number];
      blockIndex?: number;
    }
  > = {};

  for (const field of fieldNames) {
    const value = params.parsed[field];
    if (value === undefined) {
      continue;
    }

    const heuristicConfidence = inferHeuristicConfidence(field, value, warningText);
    const validationBonus = inferValidationBonus(field, validationText);
    const finalConfidence = clampProbability(ocrConfidence * heuristicConfidence * validationBonus);
    fieldConfidence[field] = Number(finalConfidence.toFixed(4));

    const provenanceSource = changedByVerifier.has(field)
      ? "slm"
      : params.templateAppliedFields.has(field)
        ? "template"
        : params.source.includes("template")
          ? "template"
          : "heuristic";
    const slmBlockIndex = params.slmBlockIndices?.[field];
    let matched: { block: OcrBlock; index: number } | undefined;
    if (typeof slmBlockIndex === "number" && slmBlockIndex >= 0 && slmBlockIndex < params.ocrBlocks.length) {
      matched = { block: params.ocrBlocks[slmBlockIndex], index: slmBlockIndex };
    } else {
      matched = findBlockByLabelProximity(field, params.ocrBlocks) ??
        findBlockForField(field, value, params.ocrBlocks, params.fieldRegions[field] ?? []);
    }
    const block = matched?.block;
    if (block) {
      fieldProvenance[field] = {
        source: provenanceSource,
        page: block.page,
        bbox: block.bbox,
        ...(block.bboxNormalized ? { bboxNormalized: block.bboxNormalized } : {}),
        ...(block.bboxModel ? { bboxModel: block.bboxModel } : {}),
        ...(typeof matched?.index === "number" ? { blockIndex: matched.index } : {})
      };
    } else {
      fieldProvenance[field] = {
        source: provenanceSource,
        page: 1
      };
    }
  }

  params.metadata.fieldConfidence = JSON.stringify(fieldConfidence);
  params.metadata.fieldProvenance = JSON.stringify(fieldProvenance);
}

function inferHeuristicConfidence(field: keyof ParsedInvoiceData, value: unknown, warningText: string): number {
  if (field === "totalAmountMinor") {
    if (typeof value !== "number" || value <= 0) {
      return 0.45;
    }
    return warningText.includes("total amount") ? 0.7 : 0.92;
  }
  if (field === "vendorName") {
    if (typeof value !== "string") {
      return 0.45;
    }
    if (looksLikeAddress(value)) {
      return 0.5;
    }
    return warningText.includes("vendor name") ? 0.68 : 0.9;
  }
  if (field === "invoiceNumber") {
    return warningText.includes("invoice number") ? 0.65 : 0.9;
  }
  if (field === "currency") {
    return warningText.includes("currency") ? 0.7 : 0.88;
  }
  return 0.82;
}

const VALIDATION_KEY_BY_FIELD: Record<string, string> = {
  totalAmountMinor: "total amount",
  vendorName: "vendor",
  invoiceNumber: "invoice number",
  currency: "currency",
  dueDate: "due date",
  invoiceDate: "invoice date"
};

function inferValidationBonus(field: keyof ParsedInvoiceData, validationText: string): number {
  const key = VALIDATION_KEY_BY_FIELD[field] ?? field;
  return validationText.includes(key) ? 0.7 : 1;
}

const FIELD_LABEL_PATTERNS: Record<string, RegExp> = {
  invoiceNumber: /^(invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#)|inv\s*(?:no\.?|#))$/i,
  vendorName: /^(vendor|supplier|sold\s*by|company|from)$/i,
  invoiceDate: /^(invoice\s*date|bill\s*date|date)$/i,
  dueDate: /^(due\s*date|payment\s*due)$/i,
  totalAmountMinor: /^(grand\s*total|total|amount\s*due|balance\s*due|net\s*payable)$/i,
  currency: /^(currency)$/i
};

function findBlockByLabelProximity(
  field: keyof ParsedInvoiceData,
  blocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  const labelPattern = FIELD_LABEL_PATTERNS[field];
  if (!labelPattern || blocks.length === 0) {
    return undefined;
  }

  if (field === "vendorName") {
    for (let i = 0; i < Math.min(5, blocks.length); i++) {
      const block = blocks[i];
      const text = block.text.trim();
      if (text.length >= 3 && !/\b(invoice|bill|date|tax|gst|gstin|msme|address)\b/i.test(text)) {
        return { block, index: i };
      }
    }
    return undefined;
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!labelPattern.test(block.text.trim())) {
      continue;
    }

    const labelBbox = block.bbox;
    if (!labelBbox || labelBbox.length < 4) {
      continue;
    }

    const labelTop = labelBbox[1];
    const labelBottom = labelBbox[3];
    const labelRight = labelBbox[2];
    const yOverlapThreshold = (labelBottom - labelTop) * 0.5;

    let bestValue: { block: OcrBlock; index: number; distance: number } | undefined;
    for (let j = 0; j < blocks.length; j++) {
      if (j === i) continue;
      const candidate = blocks[j];
      const cBbox = candidate.bbox;
      if (!cBbox || cBbox.length < 4) continue;

      const cTop = cBbox[1];
      const cBottom = cBbox[3];
      const cLeft = cBbox[0];
      const yOverlap = Math.min(labelBottom, cBottom) - Math.max(labelTop, cTop);
      if (yOverlap < yOverlapThreshold) continue;

      if (cLeft <= labelRight) continue;

      const distance = cLeft - labelRight;
      if (!bestValue || distance < bestValue.distance) {
        bestValue = { block: candidate, index: j, distance };
      }
    }

    if (bestValue) {
      return { block: bestValue.block, index: bestValue.index };
    }
  }

  return undefined;
}

function findBlockForField(
  field: keyof ParsedInvoiceData,
  value: unknown,
  blocks: OcrBlock[],
  preferredBlocks: OcrBlock[]
): { block: OcrBlock; index: number } | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  const candidate = normalizeFieldValue(field, value);
  if (!candidate) {
    return undefined;
  }

  const terms = candidateTerms(field, candidate);
  if (terms.length === 0) {
    return undefined;
  }

  const preferredSet = new Set(preferredBlocks.map((block) => block.text.trim().toLowerCase()).filter(Boolean));
  let best: { block: OcrBlock; index: number; score: number } | undefined;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const normalizedText = block.text.trim().toLowerCase();
    if (!normalizedText) {
      continue;
    }

    const keywordBonus = fieldKeywordBonus(field, normalizedText);
    let score = keywordBonus;
    let matchedTerms = 0;
    for (const term of terms) {
      if (!containsTerm(normalizedText, term)) {
        continue;
      }
      score += term.length >= 4 ? 4 : 2;
      if (normalizedText === term) {
        score += 2;
      }
      matchedTerms += 1;
    }

    if (preferredSet.has(normalizedText)) {
      score += 4;
    }

    if (matchedTerms > 0 && candidate.length > 0) {
      const valueRatio = candidate.length / Math.max(1, normalizedText.length);
      if (valueRatio > 0.5) {
        score += 3;
      }
      if (valueRatio > 0.8) {
        score += 2;
      }
    }

    if (matchedTerms > 0 && index < blocks.length * 0.3) {
      score += 2;
    }

    if (matchedTerms > 0 && /\b(beneficiary|bank|payment|bill\s*to|ship\s*to)\b/i.test(normalizedText)) {
      score -= 6;
    }

    if (normalizedText.startsWith(":") && matchedTerms > 0) {
      score += 3;
    }

    score -= blockShapePenalty(field, normalizedText);

    if (score <= 0) {
      continue;
    }

    if (field === "totalAmountMinor") {
      if (matchedTerms === 0) {
        continue;
      }
      const hasTotalKeyword = /\b(grand total|invoice total|amount due|balance due|total due|amount payable|total)\b/i.test(
        normalizedText
      );
      if (!hasTotalKeyword && keywordBonus <= 0 && matchedTerms < 2) {
        continue;
      }
    }

    if (!best || score > best.score) {
      best = { block, index, score };
    }
  }

  if (!best) {
    return undefined;
  }

  return { block: best.block, index: best.index };
}

function normalizeFieldValue(field: keyof ParsedInvoiceData, value: unknown): string {
  if (field === "totalAmountMinor") {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return "";
    }
    const major = value / 100;
    return Number.isInteger(major) ? String(major) : major.toFixed(2);
  }

  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return field === "currency" ? trimmed.toUpperCase() : trimmed;
}

function fieldKeywordBonus(field: keyof ParsedInvoiceData, text: string): number {
  if (field === "totalAmountMinor") {
    if (/\b(grand total|invoice total|amount due|balance due|total due|amount payable|total)\b/i.test(text)) {
      return 6;
    }
    if (/\b(subtotal|tax|vat|gst|charges|credit|discount)\b/i.test(text)) {
      return -3;
    }
    return 0;
  }

  if (field === "invoiceNumber") {
    return /\b(invoice|inv|bill).*(number|no|#)?\b/i.test(text) ? 4 : 0;
  }

  if (field === "vendorName") {
    if (/\b(vendor|supplier|sold by|bill from|from)\b/i.test(text)) {
      return 3;
    }
    if (looksLikeAddress(text)) {
      return -5;
    }
    return 0;
  }

  if (field === "currency") {
    return /\b(currency)\b/i.test(text) ? 2 : 0;
  }

  if (field === "invoiceDate") {
    return /\b(invoice date|date)\b/i.test(text) ? 2 : 0;
  }

  if (field === "dueDate") {
    return /\b(due date|payment terms)\b/i.test(text) ? 2 : 0;
  }

  return 0;
}

function containsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) {
    return false;
  }

  if (/\d/.test(term)) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^\\d])${escaped}([^\\d]|$)`, "i").test(haystack)) {
      return true;
    }
    const strippedHaystack = haystack.replace(/[,.\s]/g, "");
    return strippedHaystack.includes(term.replace(/[,.\s]/g, ""));
  }

  return haystack.includes(term);
}

function blockShapePenalty(field: keyof ParsedInvoiceData, text: string): number {
  const lineCount = text
    .split(/\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0).length;
  const lengthPenalty = Math.floor(text.length / 160);
  const linePenalty = lineCount > 1 ? Math.min(6, lineCount - 1) : 0;

  if (field === "totalAmountMinor") {
    if (/\b(summary|description|quantity|rate|amount|subtotal|charges)\b/i.test(text) && lineCount > 2) {
      return linePenalty + lengthPenalty + 3;
    }
    return linePenalty + lengthPenalty;
  }

  if (field === "invoiceNumber" || field === "currency" || field === "invoiceDate" || field === "dueDate") {
    return linePenalty + lengthPenalty;
  }

  if (field === "vendorName") {
    if (looksLikeAddress(text)) {
      return linePenalty + lengthPenalty + 4;
    }
    return linePenalty + lengthPenalty;
  }

  return linePenalty + lengthPenalty;
}

function buildKeyValueGroundingText(blocks: OcrBlock[]): string {
  if (blocks.length < 2) {
    return "";
  }

  const labelPattern =
    /\b(invoice(?:\s*number)?|facture|factuurnummer|rechnungsnummer|vendor|supplier|fournisseur|due(?:\s*date)?|date|total|amount|currency|betrag|montant|numero)\b/i;

  const normalizedBlocks = blocks
    .map((block) => ({
      block,
      bbox: block.bboxNormalized ?? block.bboxModel ?? block.bbox,
      text: block.text.trim()
    }))
    .filter((entry) => entry.text.length > 0)
    .sort((left, right) => {
      if (left.block.page !== right.block.page) {
        return left.block.page - right.block.page;
      }
      return left.bbox[1] - right.bbox[1];
    });

  const lines: string[] = [];
  for (const entry of normalizedBlocks) {
    const labelText = entry.text.replace(/[:\-]+$/, "").trim();
    if (!labelPattern.test(labelText)) {
      continue;
    }

    const scale = inferBlockScale(entry.bbox);
    const maxYDrift = scale === "normalized" ? 0.06 : 42;
    const minXDrift = scale === "normalized" ? -0.03 : -24;
    const labelRight = entry.bbox[2];
    const labelCenterY = (entry.bbox[1] + entry.bbox[3]) / 2;
    const candidate = normalizedBlocks
      .filter((blockEntry) => blockEntry.block.page === entry.block.page && blockEntry.block !== entry.block)
      .map((blockEntry) => {
        const valueCenterY = (blockEntry.bbox[1] + blockEntry.bbox[3]) / 2;
        const yDrift = Math.abs(valueCenterY - labelCenterY);
        const xDrift = blockEntry.bbox[0] - labelRight;
        return {
          ...blockEntry,
          yDrift,
          xDrift
        };
      })
      .filter((blockEntry) => blockEntry.xDrift >= minXDrift && blockEntry.yDrift <= maxYDrift)
      .sort((left, right) => {
        if (left.yDrift !== right.yDrift) {
          return left.yDrift - right.yDrift;
        }
        return left.xDrift - right.xDrift;
      })[0];

    if (!candidate) {
      continue;
    }

    const valueText = candidate.text.replace(/\s+/g, " ").trim();
    if (!valueText || labelPattern.test(valueText) || valueText.length > 100) {
      continue;
    }

    lines.push(`${labelText}: ${valueText}`);
  }

  return [...new Set(lines)].join("\n");
}

function buildAugmentedGroundingText(keyValueText: string, blockText: string, rawText: string): string {
  const sections = [keyValueText, blockText, rawText]
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (sections.length < 2) {
    return "";
  }

  return sections.join("\n\n");
}

function inferBlockScale(bbox: [number, number, number, number]): "normalized" | "pixel" {
  if (bbox.every((value) => Number.isFinite(value) && Math.abs(value) <= 2.5)) {
    return "normalized";
  }
  return "pixel";
}

function shouldUseLanguageHint(language: DetectedInvoiceLanguage): boolean {
  return language.code !== "und" && language.confidence >= 0.4;
}

function resolvePreOcrLanguageHint(
  language: DetectedInvoiceLanguage,
  mimeType: string
): { hint?: string; reason: "detected" | "low-confidence-detected" | "default-en" | "none" } {
  if (language.code !== "und") {
    return {
      hint: language.code,
      reason: shouldUseLanguageHint(language) ? "detected" : "low-confidence-detected"
    };
  }

  if (isDocumentMimeType(mimeType)) {
    return {
      hint: "en",
      reason: "default-en"
    };
  }

  return {
    reason: "none"
  };
}

function isDocumentMimeType(mimeType: string): boolean {
  const normalized = mimeType.trim().toLowerCase();
  return normalized.startsWith("image/") || normalized === "application/pdf";
}

function resolveDetectedLanguage(
  preOcrLanguage: DetectedInvoiceLanguage,
  postOcrLanguage: DetectedInvoiceLanguage
): DetectedInvoiceLanguage {
  if (postOcrLanguage.code === "und") {
    return preOcrLanguage;
  }

  if (preOcrLanguage.code === "und") {
    return postOcrLanguage;
  }

  if (postOcrLanguage.code === preOcrLanguage.code) {
    return {
      code: postOcrLanguage.code,
      confidence: clampProbability(Math.max(postOcrLanguage.confidence, preOcrLanguage.confidence)),
      signals: uniqueIssues([...postOcrLanguage.signals, ...preOcrLanguage.signals])
    };
  }

  if (postOcrLanguage.confidence >= preOcrLanguage.confidence - 0.12) {
    return postOcrLanguage;
  }

  return preOcrLanguage;
}

function formatConfidence(value: number): string {
  return clampProbability(value).toFixed(4);
}

function withTimeout<T>(ms: number, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Verifier timed out after ${ms}ms`)), ms)
    )
  ]);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function uniqueIssues(issues: string[]): string[] {
  return [...new Set(issues.map((issue) => issue.trim()).filter((issue) => issue.length > 0))];
}

function buildBlocksText(blocks: OcrBlock[]): string {
  if (blocks.length === 0) {
    return "";
  }

  return blocks
    .map((block) => block.text.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^(text|table|title|line|image)$/i.test(line))
    .join("\n");
}

function isNearDuplicateText(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight;
}
