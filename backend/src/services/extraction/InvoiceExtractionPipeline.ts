import type { FieldVerificationMode, FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrProvider } from "../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../types/invoice.js";
import { runInvoiceExtractionAgent, type ExtractionTextCandidate } from "../invoiceExtractionAgent.js";
import { assessInvoiceConfidence, type ConfidenceAssessment } from "../confidenceAssessment.js";
import { buildLayoutGraph } from "./layoutGraph.js";
import { validateInvoiceFields } from "./deterministicValidation.js";
import { computeVendorFingerprint } from "./vendorFingerprint.js";
import { templateFromParsed, type VendorTemplateSnapshot, type VendorTemplateStore } from "./vendorTemplateStore.js";
import type { PipelineExtractionResult } from "./types.js";
import { logger } from "../../utils/logger.js";

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

  constructor(
    private readonly ocrProvider: OcrProvider,
    private readonly fieldVerifier: FieldVerifier,
    private readonly templateStore: VendorTemplateStore,
    options?: ExtractionPipelineOptions
  ) {
    this.ocrHighConfidenceThreshold = clampProbability(options?.ocrHighConfidenceThreshold ?? 0.88);
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

    try {
      const ocrResult = await this.ocrProvider.extractText(input.fileBuffer, input.mimeType);
      ocrProvider = ocrResult.provider || this.ocrProvider.name;
      ocrBlocks = ocrResult.blocks ?? [];
      const rawText = ocrResult.text.trim();
      const blockText = buildBlocksText(ocrBlocks);
      const calibrated = calibrateDocumentConfidence(ocrResult.confidence, rawText, blockText);
      ocrConfidence = calibrated.score;
      metadata.docOcrConfidence = formatConfidence(calibrated.score);
      metadata.docLowTokenRatio = formatConfidence(calibrated.lowTokenRatio);
      metadata.docPrintableRatio = formatConfidence(calibrated.printableRatio);

      if (rawText.length > 0) {
        extractionCandidates.push({
          text: rawText,
          provider: ocrProvider,
          confidence: ocrConfidence,
          source: "ocr-provider"
        });
      }

      if (blockText.length > 0 && !isNearDuplicateText(blockText, rawText)) {
        extractionCandidates.push({
          text: blockText,
          provider: ocrProvider,
          confidence: ocrConfidence,
          source: "ocr-blocks"
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

    const layoutGraph = buildLayoutGraph(ocrBlocks);
    metadata.layoutGraphNodes = String(layoutGraph.nodes.length);
    metadata.layoutGraphEdges = String(layoutGraph.edges.length);
    metadata.layoutGraphSignature = layoutGraph.signature;

    const ocrGateHigh = clampProbability(ocrConfidence ?? 0) >= this.ocrHighConfidenceThreshold;
    metadata.ocrGate = ocrGateHigh ? "high" : "low";

    if (template) {
      const templateResult = runInvoiceExtractionAgent({
        candidates: extractionCandidates,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        autoSelectMin: input.autoSelectMin,
        referenceDate: input.referenceDate
      });
      const parsedFromTemplate = applyTemplate(template, templateResult.parseResult.parsed);
      for (const field of detectChangedFields(templateResult.parseResult.parsed, parsedFromTemplate)) {
        templateAppliedFields.add(field);
      }
      const templateWarnings = uniqueIssues(templateResult.parseResult.warnings);
      const templateConfidence = this.assessConfidence(input, parsedFromTemplate, templateWarnings, ocrConfidence);
      const templateValidation = validateInvoiceFields({
        parsed: parsedFromTemplate,
        ocrText: templateResult.text,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate
      });

      if (templateValidation.valid) {
        await this.cacheTemplate(input, fingerprint.key, fingerprint.layoutSignature, parsedFromTemplate, templateConfidence);
        addFieldDiagnosticsToMetadata({
          metadata,
          parsed: parsedFromTemplate,
          ocrBlocks,
          source: "template",
          ocrConfidence,
          validationIssues: templateValidation.issues,
          warnings: templateWarnings,
          templateAppliedFields,
          verifierChangedFields: []
        });
        return {
          provider: ocrProvider,
          text: templateResult.text,
          confidence: ocrConfidence ?? templateResult.confidence,
          source: "vendor-template",
          strategy: "template-deterministic",
          parseResult: {
            parsed: parsedFromTemplate,
            warnings: templateWarnings
          },
          confidenceAssessment: templateConfidence,
          attempts: templateResult.attempts,
          ocrBlocks,
          processingIssues: uniqueIssues(processingIssues),
          metadata
        };
      }

      processingIssues.push(
        `Template candidate failed deterministic validation: ${templateValidation.issues.join(" ")}`
      );
    }

    const heuristicResult = runInvoiceExtractionAgent({
      candidates: extractionCandidates,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      autoSelectMin: input.autoSelectMin,
      referenceDate: input.referenceDate
    });

    let parsed = heuristicResult.parseResult.parsed;
    let warnings = uniqueIssues(heuristicResult.parseResult.warnings);
    let confidence = heuristicResult.confidenceAssessment;
    let strategy = heuristicResult.strategy;
    let source = heuristicResult.source;

    let validation = validateInvoiceFields({
      parsed,
      ocrText: heuristicResult.text,
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate
    });

    const shouldVerify = !ocrGateHigh || !validation.valid;
    const verifierChangedFields: string[] = [];
    if (shouldVerify) {
      const mode: FieldVerificationMode = ocrGateHigh ? "strict" : "relaxed";
      const fieldCandidates = buildFieldCandidates(heuristicResult.text, parsed, template);
      const fieldRegions = buildFieldRegions(ocrBlocks, fieldCandidates);
      const verifierOutput = await this.fieldVerifier.verify({
        parsed,
        ocrText: heuristicResult.text,
        ocrBlocks,
        mode,
        hints: {
          mimeType: input.mimeType,
          vendorNameHint: template?.vendorName,
          vendorTemplateMatched: Boolean(template),
          fieldCandidates,
          fieldRegions
        }
      });

      const mergedParsed = mergeParsedWithVerification(parsed, verifierOutput.parsed, mode);
      const changedFields = detectChangedFields(parsed, mergedParsed);
      verifierChangedFields.push(...changedFields);
      if (changedFields.length > 0) {
        strategy = `${strategy}+verifier-${mode}`;
        metadata.verifier = this.fieldVerifier.name;
        metadata.verifierMode = mode;
        metadata.verifierChangedFields = changedFields.join(",");
      }

      if (verifierOutput.changedFields.length > 0 && !metadata.verifierChangedFields) {
        metadata.verifierChangedFields = verifierOutput.changedFields.join(",");
      }
      if (verifierOutput.reasonCodes && Object.keys(verifierOutput.reasonCodes).length > 0) {
        metadata.verifierReasonCodes = JSON.stringify(verifierOutput.reasonCodes);
      }

      parsed = mergedParsed;
      warnings = uniqueIssues([...warnings, ...verifierOutput.issues]);
      confidence = this.assessConfidence(input, parsed, warnings, ocrConfidence);
      validation = validateInvoiceFields({
        parsed,
        ocrText: heuristicResult.text,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate
      });
      metadata.verifierApplied = "true";
    }

    if (!validation.valid) {
      warnings = uniqueIssues([...warnings, ...validation.issues]);
      processingIssues.push(
        "Manual/LLM fallback required after deterministic validation and field verification."
      );
      metadata.manualFallback = "required";
    }

    addFieldDiagnosticsToMetadata({
      metadata,
      parsed,
      ocrBlocks,
      source: shouldVerify ? "heuristic+slm" : "heuristic",
      ocrConfidence,
      validationIssues: validation.issues,
      warnings,
      templateAppliedFields,
      verifierChangedFields
    });

    await this.cacheTemplate(input, fingerprint.key, fingerprint.layoutSignature, parsed, confidence);

    return {
      provider: ocrProvider,
      text: heuristicResult.text,
      confidence: ocrConfidence ?? heuristicResult.confidence,
      source,
      strategy,
      parseResult: {
        parsed,
        warnings
      },
      confidenceAssessment: confidence,
      attempts: heuristicResult.attempts,
      ocrBlocks,
      processingIssues: uniqueIssues(processingIssues),
      metadata
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
      merged[field] = candidateValue as never;
      continue;
    }

    const currentValue = merged[field];
    if (currentValue === undefined) {
      merged[field] = candidateValue as never;
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
      }
    }
  }

  return merged;
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
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }
  return left === right;
}

function looksLikeAddress(value: string): boolean {
  return /\b(address|warehouse|village|road|street|taluk|district|postal|zip)\b/i.test(value);
}

function isWeakVendorValue(value: string): boolean {
  return (
    looksLikeAddress(value) ||
    /\b(currency|invoice|total|amount|date|due|tax|gst|vat|number)\b/i.test(value)
  );
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
    ...collectMatches(text, /([$€£₹])/g).map((symbol) => symbolToCurrency(symbol))
  ]);

  const totalMatches = uniqueStrings([
    parsed.totalAmountMinor !== undefined ? String(parsed.totalAmountMinor) : undefined,
    ...collectMatches(
      text,
      /(?:grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*payable)\s*[:\-]?\s*([-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)(?:[.,]\d{1,2})?)/gi
    ).map((value) => {
      const minor = parseAmountToMinorUnits(value);
      return minor !== undefined ? String(minor) : "";
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

  const minor = Number(base);
  if (!Number.isFinite(minor) || minor <= 0) {
    return [base];
  }

  const major = (minor / 100).toFixed(2);
  const majorNoDecimals = Number.isInteger(minor / 100) ? String(Math.round(minor / 100)) : "";
  const normalizedMajor = major.replace(/\.00$/, "");

  return [base, major, normalizedMajor, majorNoDecimals]
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
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

function symbolToCurrency(symbol: string): string {
  if (symbol === "$") {
    return "USD";
  }
  if (symbol === "€") {
    return "EUR";
  }
  if (symbol === "£") {
    return "GBP";
  }
  if (symbol === "₹") {
    return "INR";
  }
  return "";
}

function parseAmountToMinorUnits(value: string): number | undefined {
  const cleaned = value.replace(/\s+/g, "");
  if (!cleaned) {
    return undefined;
  }

  let normalized = cleaned.replace(/[^0-9,.\-+]/g, "");
  if (!normalized) {
    return undefined;
  }

  const negative = normalized.startsWith("-");
  normalized = normalized.replace(/^[+-]/, "");
  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    const fractionalDigits = normalized.split(",").at(-1)?.length ?? 0;
    normalized = fractionalDigits <= 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  const minor = Math.round(parsed * 100);
  return negative ? -minor : minor;
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
  source: string;
  ocrConfidence?: number;
  validationIssues: string[];
  warnings: string[];
  templateAppliedFields: Set<string>;
  verifierChangedFields: string[];
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
  const fieldProvenance: Record<string, { source: string; page: number; bbox: [number, number, number, number] }> = {};

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
    const block = findBlockForField(field, value, params.ocrBlocks);
    fieldProvenance[field] = {
      source: provenanceSource,
      page: block?.page ?? 1,
      bbox: block?.bbox ?? [0, 0, 0, 0]
    };
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

function inferValidationBonus(field: keyof ParsedInvoiceData, validationText: string): number {
  const key =
    field === "totalAmountMinor"
      ? "total amount"
      : field === "vendorName"
        ? "vendor"
        : field === "invoiceNumber"
          ? "invoice number"
          : field === "currency"
            ? "currency"
            : field === "dueDate"
              ? "due date"
              : "invoice date";
  return validationText.includes(key) ? 0.7 : 1;
}

function findBlockForField(
  field: keyof ParsedInvoiceData,
  value: unknown,
  blocks: OcrBlock[]
): OcrBlock | undefined {
  if (blocks.length === 0) {
    return undefined;
  }

  let needle = "";
  if (typeof value === "number") {
    needle = String(Math.round(value / 100));
  } else if (typeof value === "string") {
    needle = value.trim();
  }
  if (!needle) {
    return undefined;
  }
  if (field === "currency" && typeof value === "string") {
    needle = value.toUpperCase();
  }

  const normalizedNeedle = needle.toLowerCase();
  return blocks.find((block) => block.text.toLowerCase().includes(normalizedNeedle));
}

function formatConfidence(value: number): string {
  return clampProbability(value).toFixed(4);
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
      .replace(/[^a-z0-9 ]+/g, "")
      .trim();

  const normalizedLeft = normalize(left);
  const normalizedRight = normalize(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedRight.includes(normalizedLeft);
}
