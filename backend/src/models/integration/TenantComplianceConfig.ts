import { Schema, model, type InferSchemaType, type HydratedDocument } from "mongoose";

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
    enabledSignals: { type: [String], default: [] },
    disabledSignals: { type: [String], default: [] },
    signalSeverityOverrides: { type: Map, of: String, default: {} },
    defaultTdsSection: { type: String, default: null },
    defaultTcsRateBps: { type: Number, default: null },
    updatedBy: { type: String, default: null }
  },
  { timestamps: true }
);

tenantComplianceConfigSchema.index({ tenantId: 1 }, { unique: true });

type TenantComplianceConfig = InferSchemaType<typeof tenantComplianceConfigSchema>;
type TenantComplianceConfigDocument = HydratedDocument<TenantComplianceConfig>;

export const TenantComplianceConfigModel = model<TenantComplianceConfig>("TenantComplianceConfig", tenantComplianceConfigSchema);
