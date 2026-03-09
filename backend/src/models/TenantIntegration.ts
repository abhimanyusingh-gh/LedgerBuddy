import { Schema, model, type InferSchemaType } from "mongoose";

const TenantIntegrationProviders = ["gmail"] as const;
const TenantIntegrationStatuses = ["connected", "requires_reauth", "error"] as const;

const tenantIntegrationSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    provider: { type: String, enum: TenantIntegrationProviders, required: true },
    status: { type: String, enum: TenantIntegrationStatuses, required: true, default: "error" },
    emailAddress: { type: String },
    encryptedRefreshToken: { type: String },
    createdByUserId: { type: String, required: true },
    lastErrorReason: { type: String },
    lastSyncedAt: { type: Date },
    reauthNotifiedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

tenantIntegrationSchema.index({ tenantId: 1, provider: 1 }, { unique: true });
tenantIntegrationSchema.index({ provider: 1 });

type TenantIntegration = InferSchemaType<typeof tenantIntegrationSchema>;

export const TenantIntegrationModel = model<TenantIntegration>("TenantIntegration", tenantIntegrationSchema);
