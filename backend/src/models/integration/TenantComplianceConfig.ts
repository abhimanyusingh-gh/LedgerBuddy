import { Schema, model, type InferSchemaType } from "mongoose";

const tdsRateEntrySchema = new Schema(
  {
    section: { type: String, required: true },
    description: { type: String, required: true },
    rateIndividual: { type: Number, required: true },
    rateCompany: { type: Number, required: true },
    rateNoPan: { type: Number, required: true },
    threshold: { type: Number, required: true },
    active: { type: Boolean, default: true }
  },
  { _id: false }
);

const tenantComplianceConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    complianceEnabled: { type: Boolean, default: false },
    autoSuggestGlCodes: { type: Boolean, default: true },
    autoDetectTds: { type: Boolean, default: true },
    tdsEnabled: { type: Boolean, default: false },
    tdsRates: { type: [tdsRateEntrySchema], default: [] },
    panValidationEnabled: { type: Boolean, default: false },
    panValidationLevel: { type: String, enum: ["format", "format_and_checksum", "disabled"], default: "disabled" },
    riskSignalsEnabled: { type: Boolean, default: false },
    activeRiskSignals: { type: [String], default: [] },
    disabledSignals: { type: [String], default: [] },
    signalSeverityOverrides: { type: Map, of: String, default: {} },
    defaultTdsSection: { type: String, default: null },
    defaultTcsRateBps: { type: Number, default: null },
    updatedBy: { type: String, default: null },

    maxInvoiceTotalMinor: { type: Number },
    maxDueDays: { type: Number },
    autoApprovalThreshold: { type: Number },
    eInvoiceThresholdMinor: { type: Number },
    msmePaymentWarningDays: { type: Number },
    msmePaymentOverdueDays: { type: Number },
    minimumExpectedTotalMinor: { type: Number },
    riskSignalPenaltyCap: { type: Number },
    ocrWeight: { type: Number },
    completenessWeight: { type: Number },
    warningPenalty: { type: Number },
    warningPenaltyCap: { type: Number },
    requiredFields: { type: [String] },
    confidencePenaltyOverrides: { type: Map, of: Number },
    reconciliationAutoMatchThreshold: { type: Number },
    reconciliationSuggestThreshold: { type: Number },
    reconciliationAmountToleranceMinor: { type: Number },
    invoiceDateWindowDays: { type: Number },
    defaultCurrency: { type: String },
    approvalLimitOverrides: { type: Map, of: Number },
    additionalFreemailDomains: { type: [String], default: undefined },
    learningMode: { type: String, enum: ["active", "assistive"], default: undefined }
  },
  { timestamps: true }
);

tenantComplianceConfigSchema.index({ tenantId: 1 }, { unique: true });

type TenantComplianceConfig = InferSchemaType<typeof tenantComplianceConfigSchema>;

export interface TenantComplianceConfigFields {
  tenantId: string;
  complianceEnabled?: boolean;
  autoSuggestGlCodes?: boolean;
  autoDetectTds?: boolean;
  tdsEnabled?: boolean;
  tdsRates?: Array<{
    section: string;
    description: string;
    rateIndividual: number;
    rateCompany: number;
    rateNoPan: number;
    threshold: number;
    active: boolean;
  }>;
  panValidationEnabled?: boolean;
  panValidationLevel?: "format" | "format_and_checksum" | "disabled";
  riskSignalsEnabled?: boolean;
  activeRiskSignals?: string[];
  disabledSignals?: string[];
  signalSeverityOverrides?: Record<string, string>;
  defaultTdsSection?: string | null;
  defaultTcsRateBps?: number | null;
  updatedBy?: string | null;

  maxInvoiceTotalMinor?: number;
  maxDueDays?: number;
  autoApprovalThreshold?: number;
  eInvoiceThresholdMinor?: number;
  msmePaymentWarningDays?: number;
  msmePaymentOverdueDays?: number;
  minimumExpectedTotalMinor?: number;
  riskSignalPenaltyCap?: number;
  ocrWeight?: number;
  completenessWeight?: number;
  warningPenalty?: number;
  warningPenaltyCap?: number;
  requiredFields?: string[];
  confidencePenaltyOverrides?: Record<string, number>;
  reconciliationAutoMatchThreshold?: number;
  reconciliationSuggestThreshold?: number;
  reconciliationAmountToleranceMinor?: number;
  invoiceDateWindowDays?: number;
  defaultCurrency?: string;
  approvalLimitOverrides?: Record<string, number>;
  additionalFreemailDomains?: string[];
  learningMode?: "active" | "assistive";
}

export const TenantComplianceConfigModel = model<TenantComplianceConfig>("TenantComplianceConfig", tenantComplianceConfigSchema);
