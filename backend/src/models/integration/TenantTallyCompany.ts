import { Schema, model, type InferSchemaType } from "mongoose";

export const TALLY_VERSION = {
  ERP9: "erp9",
  Prime: "prime",
  PrimeServer: "primeServer"
} as const;
export type TallyVersion = typeof TALLY_VERSION[keyof typeof TALLY_VERSION];

const tenantTallyCompanySchema = new Schema(
  {
    tenantId: { type: String, required: true },
    companyName: { type: String },
    companyGuid: { type: String },
    stateName: { type: String },
    f12OverwriteByGuidVerified: { type: Boolean, required: true, default: false },
    detectedVersion: {
      type: String,
      enum: Object.values(TALLY_VERSION),
      required: false,
      default: null
    }
  },
  { timestamps: true }
);

tenantTallyCompanySchema.index({ tenantId: 1 }, { unique: true });

type TenantTallyCompany = InferSchemaType<typeof tenantTallyCompanySchema>;

export const TenantTallyCompanyModel = model<TenantTallyCompany>(
  "TenantTallyCompany",
  tenantTallyCompanySchema
);
