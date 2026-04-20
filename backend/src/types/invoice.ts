import type { ExtractionSource } from "@/core/engine/extractionSource.js";
import type { RiskSignalCode } from "@/types/riskSignals.js";

export const INVOICE_STATUS = {
  PENDING: "PENDING",
  PARSED: "PARSED",
  NEEDS_REVIEW: "NEEDS_REVIEW",
  AWAITING_APPROVAL: "AWAITING_APPROVAL",
  FAILED_OCR: "FAILED_OCR",
  FAILED_PARSE: "FAILED_PARSE",
  APPROVED: "APPROVED",
  EXPORTED: "EXPORTED",
} as const;

export const INVOICE_FIELD_KEY = {
  INVOICE_NUMBER: "invoiceNumber",
  VENDOR_NAME: "vendorName",
  VENDOR_ADDRESS: "vendorAddress",
  VENDOR_GSTIN: "vendorGstin",
  VENDOR_PAN: "vendorPan",
  CUSTOMER_NAME: "customerName",
  CUSTOMER_ADDRESS: "customerAddress",
  CUSTOMER_GSTIN: "customerGstin",
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

export const InvoiceStatuses = Object.values(INVOICE_STATUS);

export type InvoiceStatus = (typeof INVOICE_STATUS)[keyof typeof INVOICE_STATUS];

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

export const PROVENANCE_SOURCE = {
  SLM: "slm",
  TEXT_PATTERN: "text-pattern",
  TEMPLATE: "template",
} as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCE)[keyof typeof PROVENANCE_SOURCE];

export const PAN_SOURCE = {
  EXTRACTED: "extracted",
  VENDOR_MASTER: "vendor-master",
  MANUAL: "manual",
} as const;

export type PanSource = (typeof PAN_SOURCE)[keyof typeof PAN_SOURCE];

export const PAN_VALIDATION_LEVEL = {
  L1: "L1",
  L2: "L2",
  L3: "L3",
} as const;

export type PanValidationLevel = (typeof PAN_VALIDATION_LEVEL)[keyof typeof PAN_VALIDATION_LEVEL];

export const PAN_VALIDATION_RESULT = {
  VALID: "valid",
  FORMAT_INVALID: "format-invalid",
  GSTIN_MISMATCH: "gstin-mismatch",
  STRUCK_OFF: "struck-off",
} as const;

export type PanValidationResult = (typeof PAN_VALIDATION_RESULT)[keyof typeof PAN_VALIDATION_RESULT];

export const TDS_SOURCE = {
  AUTO: "auto",
  MANUAL: "manual",
} as const;

export type TdsSource = (typeof TDS_SOURCE)[keyof typeof TDS_SOURCE];

export const TDS_CONFIDENCE = {
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
} as const;

export type TdsConfidence = (typeof TDS_CONFIDENCE)[keyof typeof TDS_CONFIDENCE];

export const GL_CODE_SOURCE = {
  VENDOR_DEFAULT: "vendor-default",
  DESCRIPTION_MATCH: "description-match",
  SLM_CLASSIFICATION: "slm-classification",
  CATEGORY_DEFAULT: "category-default",
  MANUAL: "manual",
} as const;

export type GlCodeSource = (typeof GL_CODE_SOURCE)[keyof typeof GL_CODE_SOURCE];

export const COST_CENTER_SOURCE = {
  VENDOR_DEFAULT: "vendor-default",
  GL_LINKED: "gl-linked",
  MANUAL: "manual",
} as const;

export type CostCenterSource = (typeof COST_CENTER_SOURCE)[keyof typeof COST_CENTER_SOURCE];

export const MSME_CLASSIFICATION = {
  MICRO: "micro",
  SMALL: "small",
  MEDIUM: "medium",
} as const;

export type MsmeClassification = (typeof MSME_CLASSIFICATION)[keyof typeof MSME_CLASSIFICATION];

export const TCS_SOURCE = {
  EXTRACTED: "extracted",
  CONFIGURED: "configured",
  MANUAL: "manual",
} as const;

export type TcsSource = (typeof TCS_SOURCE)[keyof typeof TCS_SOURCE];

export const RISK_SIGNAL_CATEGORY = {
  FINANCIAL: "financial",
  COMPLIANCE: "compliance",
  FRAUD: "fraud",
  DATA_QUALITY: "data-quality",
} as const;

export const RISK_SIGNAL_SEVERITY = {
  INFO: "info",
  WARNING: "warning",
  CRITICAL: "critical",
} as const;

export const RISK_SIGNAL_STATUS = {
  OPEN: "open",
  DISMISSED: "dismissed",
  ACTED_ON: "acted-on",
} as const;

export interface InvoiceFieldProvenance {
  source?: ProvenanceSource | string;
  page?: number;
  bbox?: BoundingBox;
  bboxNormalized?: BoundingBox;
  bboxModel?: BoundingBox;
  blockIndex?: number;
  blockIndices?: number[];
  confidence?: number;
  parsingConfidence?: number;
  extractionConfidence?: number;
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
  vendorAddress?: string;
  vendorGstin?: string;
  vendorPan?: string;
  customerName?: string;
  customerAddress?: string;
  customerGstin?: string;
  invoiceDate?: Date;
  dueDate?: Date;
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
  source: PanSource;
  validationLevel: PanValidationLevel | null;
  validationResult: PanValidationResult | null;
  gstinCrossRef: boolean;
}

export interface ComplianceTdsResult {
  section: string | null;
  rate: number | null;
  amountMinor: number | null;
  netPayableMinor: number | null;
  source: TdsSource;
  confidence: TdsConfidence;
}

export interface ComplianceGlCodeResult {
  code: string | null;
  name: string | null;
  source: GlCodeSource;
  confidence: number | null;
  suggestedAlternatives?: Array<{ code: string; name: string; score: number }>;
}

export interface ComplianceCostCenterResult {
  code: string | null;
  name: string | null;
  source: CostCenterSource;
  confidence: number | null;
}

export interface ComplianceIrnResult {
  value: string | null;
  valid: boolean | null;
}

export interface ComplianceMsmeResult {
  udyamNumber: string | null;
  classification: MsmeClassification | null;
  paymentDeadline: Date | null;
}

export interface ComplianceTcsResult {
  rate: number | null;
  amountMinor: number | null;
  source: TcsSource;
}

export interface ComplianceVendorBankResult {
  accountHash: string | null;
  ifsc: string | null;
  bankName: string | null;
  isChanged: boolean;
  verifiedChange: boolean;
}

export type RiskSignalCategory = (typeof RISK_SIGNAL_CATEGORY)[keyof typeof RISK_SIGNAL_CATEGORY];
export type RiskSignalSeverity = (typeof RISK_SIGNAL_SEVERITY)[keyof typeof RISK_SIGNAL_SEVERITY];
export type RiskSignalStatus = (typeof RISK_SIGNAL_STATUS)[keyof typeof RISK_SIGNAL_STATUS];

export interface ComplianceRiskSignal {
  code: RiskSignalCode;
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

