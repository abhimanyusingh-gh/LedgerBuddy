import { Schema, model, type InferSchemaType } from "mongoose";

const TenantOnboardingStatuses = ["pending", "completed"] as const;

const TenantCountries = ["IN"] as const;

const TenantModes = ["test", "live"] as const;

const tenantSchema = new Schema(
  {
    name: { type: String, required: true },
    onboardingStatus: { type: String, enum: TenantOnboardingStatuses, required: true, default: "pending" },
    country: { type: String, enum: TenantCountries, required: true, default: "IN" },
    defaultCurrency: { type: String, required: true, default: "INR" },
    mode: { type: String, enum: TenantModes, required: true, default: "test" }
  },
  {
    timestamps: true
  }
);

tenantSchema.index({ createdAt: 1 });

type Tenant = InferSchemaType<typeof tenantSchema>;

export const TenantModel = model<Tenant>("Tenant", tenantSchema);
