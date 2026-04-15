import type { ExtractionSource } from "@/core/engine/extractionSource.js";

export const INVOICE_FIELD_KEY = {
  INVOICE_NUMBER: "invoiceNumber",
  VENDOR_NAME: "vendorName",
  INVOICE_DATE: "invoiceDate",
  DUE_DATE: "dueDate",
  CURRENCY: "currency",
  TOTAL_AMOUNT_MINOR: "totalAmountMinor",
  NOTES: "notes",
  PAN: "pan",
  BANK_ACCOUNT_NUMBER: "bankAccountNumber",
  BANK_IFSC: "bankIfsc",
  GST_GSTIN: "gst.gstin",
  GST_SUBTOTAL_MINOR: "gst.subtotalMinor",
  GST_CGST_MINOR: "gst.cgstMinor",
  GST_SGST_MINOR: "gst.sgstMinor",
  GST_IGST_MINOR: "gst.igstMinor",
  GST_CESS_MINOR: "gst.cessMinor",
  GST_TOTAL_TAX_MINOR: "gst.totalTaxMinor",
} as const;

export type InvoiceFieldKey = (typeof INVOICE_FIELD_KEY)[keyof typeof INVOICE_FIELD_KEY];

export const InvoiceStatuses = [
  "PENDING",
  "PARSED",
  "NEEDS_REVIEW",
  "AWAITING_APPROVAL",
  "FAILED_OCR",
  "FAILED_PARSE",
  "APPROVED",
  "EXPORTED"
] as const;

export type InvoiceStatus = (typeof InvoiceStatuses)[number];

export interface GstBreakdown {
  gstin?: string;
  subtotalMinor?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
  cessMinor?: number;
  totalTaxMinor?: number;
}

export interface InvoiceLineItem {
  description: string;
  hsnSac?: string;
  quantity?: number;
  rate?: number;
  amountMinor: number;
  taxRate?: number;
  cgstMinor?: number;
  sgstMinor?: number;
  igstMinor?: number;
}

export type BoundingBox = [number, number, number, number];

export interface InvoiceFieldProvenance {
  source?: string;
  page?: number;
  bbox?: BoundingBox;
  bboxNormalized?: BoundingBox;
  bboxModel?: BoundingBox;
  blockIndex?: number;
  blockIndices?: number[];
  confidence?: number;
}

export interface InvoiceLineItemProvenance {
  index: number;
  row?: InvoiceFieldProvenance;
  fields?: Record<string, InvoiceFieldProvenance>;
}

export interface InvoiceValueWithProvenance<T> {
  value: T;
  provenance?: InvoiceFieldProvenance;
}

export interface InvoiceLineItemContractEntry {
  description?: string;
  amountMinor: number;
  provenance?: InvoiceFieldProvenance;
}

export interface InvoiceVerifierContract {
  file?: string;
  lineItemCount?: number;
  invoiceNumber?: InvoiceValueWithProvenance<string>;
  vendorNameContains?: InvoiceValueWithProvenance<string>;
  invoiceDate?: InvoiceValueWithProvenance<string>;
  dueDate?: InvoiceValueWithProvenance<string>;
  currency?: InvoiceValueWithProvenance<string>;
  totalAmountMinor?: InvoiceValueWithProvenance<number>;
  lineItems?: InvoiceLineItemContractEntry[];
  gst?: {
    cgstMinor?: InvoiceValueWithProvenance<number>;
    sgstMinor?: InvoiceValueWithProvenance<number>;
    subtotalMinor?: InvoiceValueWithProvenance<number>;
    totalTaxMinor?: InvoiceValueWithProvenance<number>;
    igstMinor?: InvoiceValueWithProvenance<number>;
    cessMinor?: InvoiceValueWithProvenance<number>;
  };
}

export interface InvoiceExtractionClassification {
  invoiceType?: string;
  category?: string;
  glCategory?: string;
  tdsSection?: string;
}

export interface InvoiceExtractionData {
  source?: ExtractionSource;
  strategy?: ExtractionSource;
  invoiceType?: string;
  classification?: InvoiceExtractionClassification;
  fieldConfidence?: Partial<Record<InvoiceFieldKey, number>>;
  fieldProvenance?: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>>;
  lineItemProvenance?: InvoiceLineItemProvenance[];
  fieldOverlayPaths?: Partial<Record<InvoiceFieldKey, string>>;
}

export interface ParsedInvoiceData {
  invoiceNumber?: string;
  vendorName?: string;
  invoiceDate?: string;
  dueDate?: string;
  totalAmountMinor?: number;
  currency?: string;
  notes?: string[];
  gst?: GstBreakdown;
  pan?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  lineItems?: InvoiceLineItem[];
}

export interface CompliancePanResult {
  value: string | null;
  source: "extracted" | "vendor-master" | "manual";
  validationLevel: "L1" | "L2" | "L3" | null;
  validationResult: "valid" | "format-invalid" | "gstin-mismatch" | "struck-off" | null;
  gstinCrossRef: boolean;
}

export interface ComplianceTdsResult {
  section: string | null;
  rate: number | null;
  amountMinor: number | null;
  netPayableMinor: number | null;
  source: "auto" | "manual";
  confidence: "high" | "medium" | "low";
}

export interface ComplianceGlCodeResult {
  code: string | null;
  name: string | null;
  source: "vendor-default" | "description-match" | "slm-classification" | "category-default" | "manual";
  confidence: number | null;
  suggestedAlternatives?: Array<{ code: string; name: string; score: number }>;
}

export interface ComplianceCostCenterResult {
  code: string | null;
  name: string | null;
  source: "vendor-default" | "gl-linked" | "manual";
  confidence: number | null;
}

export interface ComplianceIrnResult {
  value: string | null;
  valid: boolean | null;
}

export interface ComplianceMsmeResult {
  udyamNumber: string | null;
  classification: "micro" | "small" | "medium" | null;
  paymentDeadline: Date | null;
}

export interface ComplianceTcsResult {
  rate: number | null;
  amountMinor: number | null;
  source: "extracted" | "configured" | "manual";
}

export interface ComplianceVendorBankResult {
  accountHash: string | null;
  ifsc: string | null;
  bankName: string | null;
  isChanged: boolean;
  verifiedChange: boolean;
}

export type RiskSignalCategory = "financial" | "compliance" | "fraud" | "data-quality";
export type RiskSignalSeverity = "info" | "warning" | "critical";
export type RiskSignalStatus = "open" | "dismissed" | "acted-on";

export interface ComplianceRiskSignal {
  code: string;
  category: RiskSignalCategory;
  severity: RiskSignalSeverity;
  message: string;
  confidencePenalty: number;
  status: RiskSignalStatus;
  resolvedBy: string | null;
  resolvedAt: Date | null;
}

export interface InvoiceCompliance {
  pan?: CompliancePanResult;
  tds?: ComplianceTdsResult;
  tcs?: ComplianceTcsResult;
  glCode?: ComplianceGlCodeResult;
  costCenter?: ComplianceCostCenterResult;
  irn?: ComplianceIrnResult;
  msme?: ComplianceMsmeResult;
  vendorBank?: ComplianceVendorBankResult;
  riskSignals?: ComplianceRiskSignal[];
  reconciliation?: {
    bankTransactionId: string | null;
    verifiedByStatement: boolean;
    matchedAt: Date | null;
  };
}

interface ComplianceSummary {
  tdsSection: string | null;
  glCode: string | null;
  riskSignalCount: number;
  riskSignalMaxSeverity: RiskSignalSeverity | null;
}
