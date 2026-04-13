import type { OcrBlock } from "./OcrProvider.js";
import type {
  InvoiceExtractionClassification,
  InvoiceVerifierContract,
  InvoiceFieldProvenance,
  InvoiceLineItemProvenance,
  ParsedInvoiceData
} from "../../types/invoice.js";
import type { MergedBlock, NormalizedAmount, NormalizedCurrency, NormalizedDate, OcrLine, OcrTable } from "../../ocr/ocrPostProcessor.js";

export type FieldVerificationMode = "strict" | "relaxed";

export interface FieldVerifierInput {
  parsed: ParsedInvoiceData;
  ocrText: string;
  ocrBlocks: OcrBlock[];
  mode: FieldVerificationMode;
  hints: {
    mimeType: string;
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
    pageImages?: Array<{ page: number; mimeType: string; dataUrl: string; width?: number; height?: number; dpi?: number }>;
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
    structuredTables?: OcrTable[];
    normalizedAmounts?: NormalizedAmount[];
    normalizedDates?: NormalizedDate[];
    normalizedCurrencies?: NormalizedCurrency[];
  };
}

export interface FieldVerifierResult {
  parsed: ParsedInvoiceData;
  issues: string[];
  changedFields: string[];
  reasonCodes?: Record<string, string>;
  invoiceType?: string;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  contract?: InvoiceVerifierContract;
  fieldConfidence?: Record<string, number>;
  fieldProvenance?: Record<string, InvoiceFieldProvenance>;
  lineItemProvenance?: InvoiceLineItemProvenance[];
  classification?: InvoiceExtractionClassification;
  slmUnavailable?: boolean;
}

export interface FieldVerifier {
  readonly name: string;
  verify(input: FieldVerifierInput): Promise<FieldVerifierResult>;
}
