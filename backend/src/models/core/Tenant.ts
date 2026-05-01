import { Schema, model, type InferSchemaType } from "mongoose";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";
import { TAN_FORMAT, type TAN } from "@/types/tan.js";

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
    enabled: { type: Boolean, required: true, default: true },
    tan: {
      type: String,
      default: null,
      validate: {
        validator: (value: string | null) => value === null || TAN_FORMAT.test(value),
        message: "Tenant.tan must match the 10-character TAN format (e.g. ABCD12345E)"
      }
    }
  },
  {
    timestamps: true
  }
);

tenantSchema.index({ createdAt: 1 });

type RawTenant = InferSchemaType<typeof tenantSchema>;

type Tenant = Omit<RawTenant, "tan"> & { tan: TAN | null };

export const TenantModel = model<Tenant>("Tenant", tenantSchema);
