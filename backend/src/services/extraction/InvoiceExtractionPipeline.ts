import type { FieldVerificationMode, FieldVerifier } from "../../core/interfaces/FieldVerifier.js";
import type { OcrBlock, OcrProvider } from "../../core/interfaces/OcrProvider.js";
import type { ParsedInvoiceData } from "../../types/invoice.js";
import { runInvoiceExtractionAgent, type ExtractionTextCandidate } from "../invoiceExtractionAgent.js";
import { assessInvoiceConfidence, type ConfidenceAssessment } from "../confidenceAssessment.js";
import { extractNativePdfText } from "../pdfTextExtractor.js";
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
    if (input.mimeType === "application/pdf") {
      try {
        const nativeText = await extractNativePdfText(input.fileBuffer);
        if (nativeText.trim().length > 24) {
          extractionCandidates.push({
            text: nativeText,
            provider: "pdf-native",
            confidence: 1,
            source: "pdf-native"
          });
        }
      } catch {
        processingIssues.push("Native PDF text extraction failed. Falling back to OCR provider.");
      }
    }

    let ocrProvider = this.ocrProvider.name;
    let ocrConfidence: number | undefined;
    let ocrBlocks: OcrBlock[] = [];

    try {
      const ocrResult = await this.ocrProvider.extractText(input.fileBuffer, input.mimeType);
      ocrProvider = ocrResult.provider || this.ocrProvider.name;
      ocrConfidence = ocrResult.confidence;
      ocrBlocks = ocrResult.blocks ?? [];
      const rawText = ocrResult.text.trim();
      const blockText = buildBlocksText(ocrBlocks);

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
      const templateWarnings = uniqueIssues(templateResult.parseResult.warnings);
      const templateConfidence = this.assessConfidence(input, parsedFromTemplate, templateWarnings, ocrConfidence);
      const templateValidation = validateInvoiceFields({
        parsed: parsedFromTemplate,
        expectedMaxTotal: input.expectedMaxTotal,
        expectedMaxDueDays: input.expectedMaxDueDays,
        referenceDate: input.referenceDate
      });

      if (templateValidation.valid) {
        await this.cacheTemplate(input, fingerprint.key, fingerprint.layoutSignature, parsedFromTemplate, templateConfidence);
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
      expectedMaxTotal: input.expectedMaxTotal,
      expectedMaxDueDays: input.expectedMaxDueDays,
      referenceDate: input.referenceDate
    });

    const shouldVerify = !ocrGateHigh || !validation.valid;
    if (shouldVerify) {
      const mode: FieldVerificationMode = ocrGateHigh ? "strict" : "relaxed";
      const verifierOutput = await this.fieldVerifier.verify({
        parsed,
        ocrText: heuristicResult.text,
        ocrBlocks,
        mode,
        hints: {
          mimeType: input.mimeType,
          vendorNameHint: template?.vendorName,
          vendorTemplateMatched: Boolean(template)
        }
      });

      const mergedParsed = mergeParsedWithVerification(parsed, verifierOutput.parsed, mode);
      const changedFields = detectChangedFields(parsed, mergedParsed);
      if (changedFields.length > 0) {
        strategy = `${strategy}+verifier-${mode}`;
        metadata.verifier = this.fieldVerifier.name;
        metadata.verifierMode = mode;
        metadata.verifierChangedFields = changedFields.join(",");
      }

      if (verifierOutput.changedFields.length > 0 && !metadata.verifierChangedFields) {
        metadata.verifierChangedFields = verifierOutput.changedFields.join(",");
      }

      parsed = mergedParsed;
      warnings = uniqueIssues([...warnings, ...verifierOutput.issues]);
      confidence = this.assessConfidence(input, parsed, warnings, ocrConfidence);
      validation = validateInvoiceFields({
        parsed,
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
