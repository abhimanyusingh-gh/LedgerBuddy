import { Schema, model, type InferSchemaType } from "mongoose";
import { GSTIN_FORMAT } from "@/constants/indianCompliance.js";

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
    gstin: {
      type: String,
      required: false,
      default: null,
      validate: {
        validator: (value: string | null | undefined) =>
          value === null || value === undefined || value === "" || GSTIN_FORMAT.test(value),
        message: "TenantTallyCompany.gstin must match the 15-character GSTIN format"
      }
    },
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
