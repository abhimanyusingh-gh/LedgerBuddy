import type { OcrBlock } from "@/core/interfaces/OcrProvider.js";
import type {
  InvoiceExtractionClassification,
  InvoiceFieldKey,
  InvoiceVerifierContract,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "@/types/invoice.js";
import type { DocumentMimeType, ImageMimeType } from "@/types/mime.js";
import type { MergedBlock, OcrLine } from "@/ai/ocr/ocrPostProcessor.js";

export type FieldVerificationMode = "strict" | "relaxed";

export interface FieldVerifierInput {
  parsed: ParsedInvoiceData;
  ocrText: string;
  ocrBlocks: OcrBlock[];
  mode: FieldVerificationMode;
  hints: {
    mimeType: DocumentMimeType;
    languageHint?: string;
    documentLanguage?: string;
    documentLanguageConfidence?: number;
    preOcrLanguage?: string;
    preOcrLanguageConfidence?: number;
    postOcrLanguage?: string;
    postOcrLanguageConfidence?: number;
    vendorNameHint?: string;
    vendorTemplateMatched: boolean;
    fieldCandidates: Record<string, string[]>;
    fieldRegions?: Record<string, OcrBlock[]>;
    pageImages?: Array<{ page: number; mimeType: ImageMimeType; dataUrl: string; width?: number; height?: number; dpi?: number }>;
    llmAssist?: boolean;
    priorCorrections?: Array<{ field: string; hint: string; count: number }>;
    extractionMode?: string;
    documentContext?: string;
    fileName?: string;
    attachmentName?: string;
    bankStatementPrompt?: string;
    glCategories?: string[];
    ocrTextVariant?: string;
    ocrCandidateScores?: Array<{ id: string; score: number }>;
    mergedBlocks?: MergedBlock[];
    structuredLines?: OcrLine[];
  };
}

export interface FieldVerifierResult {
  parsed: ParsedInvoiceData;
  issues: string[];
  changedFields: string[];
  reasonCodes?: Partial<Record<InvoiceFieldKey, string>>;
  invoiceType?: string;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  contract?: InvoiceVerifierContract;
  fieldConfidence?: Partial<Record<InvoiceFieldKey, number>>;
  fieldProvenance?: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>;
  lineItemProvenance?: InvoiceLineItemProvenance[];
  classification?: InvoiceExtractionClassification;
  slmUnavailable?: boolean;
}

export interface FieldVerifier {
  readonly name: string;
  verify(input: FieldVerifierInput): Promise<FieldVerifierResult>;
}
