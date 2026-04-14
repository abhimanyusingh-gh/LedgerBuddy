import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import type { SinglePassDocumentDefinition, ExtractionSchema } from "@/core/engine/DocumentDefinition.js";
import { DOC_TYPE } from "@/core/engine/DocumentDefinition.js";
import type { ValidationResult } from "@/core/engine/types.js";
import { LLAMA_EXTRACT_INVOICE_SCHEMA } from "@/ai/schemas/invoice/llamaExtractInvoiceSchema.js";
import type {
  InvoiceExtractionData,
  InvoiceFieldKey,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "@/types/invoice.js";
import type { EnhancedOcrResult } from "@/ai/ocr/ocrPostProcessor.js";
import type { RankedOcrTextCandidate } from "../stages/ocrTextCandidates.js";
import type { DetectedInvoiceLanguage } from "./languageDetection.js";
import type { VendorTemplateSnapshot } from "./learning/vendorTemplateStore.js";
import { validateInvoiceFields } from "./deterministicValidation.js";
import { parseLlamaExtractFields } from "./adapters/LlamaExtractAdapter.js";
import { sanitizeInvoiceExtraction } from "./InvoiceExtractionSanitizer.js";

export interface InvoiceSlmOutput {
  parsed: ParsedInvoiceData;
  tokens: number;
  issues: string[];
  changedFields: string[];
  fieldConfidence?: Partial<Record<InvoiceFieldKey, number>>;
  fieldProvenance?: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>;
  lineItemProvenance: InvoiceLineItemProvenance[];
  classification?: InvoiceExtractionData["classification"];
}

interface InvoiceSlmContext {
  mimeType: string;
  attachmentName: string;
  template: VendorTemplateSnapshot | undefined;
  language: {
    preOcr: DetectedInvoiceLanguage;
    postOcr: DetectedInvoiceLanguage;
    resolved: DetectedInvoiceLanguage;
  };
  enhanced: EnhancedOcrResult;
  primaryCandidate: RankedOcrTextCandidate;
  rankedCandidates: RankedOcrTextCandidate[];
  augmentedText: string;
  ocrConfidence: number;
  ocrPageImages: OcrPageImage[];
  baselineParsed: ParsedInvoiceData;
  fieldCandidates: Record<string, string[]>;
  fieldRegions: Record<string, OcrBlock[]>;
  ocrHighConfidenceThreshold: number;
  llmAssistConfidenceThreshold: number;
  learningMode: string;
}

export interface InvoiceValidationContext {
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
  ocrText: string;
}

export class InvoiceDocumentDefinition implements SinglePassDocumentDefinition<InvoiceSlmOutput> {
  readonly docType = DOC_TYPE.INVOICE;
  readonly extractionSchema: ExtractionSchema = LLAMA_EXTRACT_INVOICE_SCHEMA as ExtractionSchema;

  private _validationContext: InvoiceValidationContext | null = null;

  setValidationContext(ctx: InvoiceValidationContext): void {
    this._validationContext = ctx;
  }

  canChunk(): boolean {
    return false;
  }

  buildPrompt(text: string, _blocks: OcrBlock[], _pageImages: OcrPageImage[]): string {
    return text;
  }

  parseOutput(raw: string | Record<string, unknown>): InvoiceSlmOutput {
    if (typeof raw === "string") {
      return this.parseFromVerifierResult(raw);
    }
    return this.parseFromExtractFields(raw);
  }

  private parseFromVerifierResult(rawJson: string): InvoiceSlmOutput {
    let parsedData: ParsedInvoiceData | undefined;
    try {
      parsedData = JSON.parse(rawJson) as ParsedInvoiceData;
    } catch {
      parsedData = undefined;
    }

    if (!parsedData || Object.keys(parsedData).length === 0) {
      return {
        parsed: {},
        tokens: 0,
        issues: ["SLM verification failed. Falling back to OCR heuristics."],
        changedFields: [],
        lineItemProvenance: []
      };
    }

    const normalizedParsed = sanitizeInvoiceExtraction(parsedData);
    const parsed = Object.keys(normalizedParsed).length > 0 ? normalizedParsed : {};

    return {
      parsed,
      tokens: 0,
      issues: [],
      changedFields: [],
      lineItemProvenance: []
    };
  }

  private parseFromExtractFields(fields: Record<string, unknown>): InvoiceSlmOutput {
    const parsed = parseLlamaExtractFields(fields);

    const rawProvenance = fields["__extract_provenance__"];
    const fieldProvenance = buildFieldProvenanceFromExtract(rawProvenance);

    return {
      parsed,
      tokens: 0,
      issues: [],
      changedFields: [],
      lineItemProvenance: [],
      ...(fieldProvenance ? { fieldProvenance } : {})
    };
  }

  validateOutput(output: InvoiceSlmOutput): ValidationResult {
    if (!this._validationContext) {
      return { valid: true, issues: [] };
    }
    const result = validateInvoiceFields({
      parsed: output.parsed,
      ocrText: this._validationContext.ocrText,
      expectedMaxTotal: this._validationContext.expectedMaxTotal,
      expectedMaxDueDays: this._validationContext.expectedMaxDueDays,
      referenceDate: this._validationContext.referenceDate
    });
    return result;
  }
}

const EXTRACT_KEY_TO_INVOICE_FIELD: Record<string, InvoiceFieldKey> = {
  invoice_number: "invoiceNumber",
  vendor_name: "vendorName",
  invoice_date: "invoiceDate",
  due_date: "dueDate",
  total_amount: "totalAmountMinor"
};

function buildFieldProvenanceFromExtract(
  raw: unknown
): Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const provenance = raw as Record<string, { page?: number; bboxNormalized?: [number, number, number, number]; confidence?: number }>;
  const result: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> = {};
  for (const [extractKey, meta] of Object.entries(provenance)) {
    const invoiceKey = EXTRACT_KEY_TO_INVOICE_FIELD[extractKey];
    if (!invoiceKey) continue;
    if (meta.page === undefined && meta.bboxNormalized === undefined) continue;
    result[invoiceKey] = {
      ...(meta.page !== undefined ? { page: meta.page } : {}),
      ...(meta.bboxNormalized !== undefined ? { bboxNormalized: meta.bboxNormalized } : {})
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
