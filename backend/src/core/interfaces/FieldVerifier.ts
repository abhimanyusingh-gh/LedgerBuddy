import type { OcrBlock } from "./OcrProvider.js";
import type { ParsedInvoiceData } from "../../types/invoice.js";

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
  };
}

export interface FieldVerifierResult {
  parsed: ParsedInvoiceData;
  issues: string[];
  changedFields: string[];
  reasonCodes?: Record<string, string>;
  invoiceType?: string;
  tokenUsage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

export interface FieldVerifier {
  readonly name: string;
  verify(input: FieldVerifierInput): Promise<FieldVerifierResult>;
}
