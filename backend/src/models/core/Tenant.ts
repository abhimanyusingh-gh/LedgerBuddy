import { Schema, model, type InferSchemaType } from "mongoose";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";

const TenantOnboardingStatuses = Object.values(ONBOARDING_STATUS);

const TenantCountries = ["IN"] as const;

const TenantModes = Object.values(TENANT_MODE);

const tenantSchema = new Schema(
  {
    name: { type: String, required: true },
    onboardingStatus: { type: String, enum: TenantOnboardingStatuses, required: true, default: ONBOARDING_STATUS.PENDING },
    country: { type: String, enum: TenantCountries, required: true, default: "IN" },
    defaultCurrency: { type: String, required: true, default: "INR" },
    mode: { type: String, enum: TenantModes, required: true, default: TENANT_MODE.TEST },
    enabled: { type: Boolean, required: true, default: true }
  },
  {
    timestamps: true
  }
);

tenantSchema.index({ createdAt: 1 });

type Tenant = InferSchemaType<typeof tenantSchema>;

export const TenantModel = model<Tenant>("Tenant", tenantSchema);
