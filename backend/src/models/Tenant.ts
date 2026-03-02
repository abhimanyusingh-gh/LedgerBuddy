import { Schema, model, type InferSchemaType } from "mongoose";

export const TenantOnboardingStatuses = ["pending", "completed"] as const;

const tenantSchema = new Schema(
  {
    name: { type: String, required: true },
    onboardingStatus: { type: String, enum: TenantOnboardingStatuses, required: true, default: "pending" }
  },
  {
    timestamps: true
  }
);

type Tenant = InferSchemaType<typeof tenantSchema>;

export const TenantModel = model<Tenant>("Tenant", tenantSchema);
