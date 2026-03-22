import { Schema, model, type InferSchemaType } from "mongoose";

const TenantIntegrationProviders = ["gmail"] as const;
const TenantIntegrationStatuses = ["connected", "requires_reauth", "error"] as const;
export const ALLOWED_POLLING_INTERVALS_HOURS = [1, 2, 4, 8] as const;
export type PollingIntervalHours = (typeof ALLOWED_POLLING_INTERVALS_HOURS)[number];

const pollingConfigSchema = new Schema({
  enabled: { type: Boolean, required: true, default: false },
  intervalHours: { type: Number, enum: ALLOWED_POLLING_INTERVALS_HOURS, required: true, default: 4 },
  lastPolledAt: { type: Date },
  nextPollAfter: { type: Date }
}, { _id: false });

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
    reauthNotifiedAt: { type: Date },
    pollingConfig: { type: pollingConfigSchema, default: undefined }
  },
  {
    timestamps: true
  }
);

tenantIntegrationSchema.index({ tenantId: 1, provider: 1, emailAddress: 1 }, { unique: true });
tenantIntegrationSchema.index({ provider: 1 });
tenantIntegrationSchema.index({ "pollingConfig.enabled": 1, "pollingConfig.nextPollAfter": 1, status: 1 });

type TenantIntegration = InferSchemaType<typeof tenantIntegrationSchema>;

export const TenantIntegrationModel = model<TenantIntegration>("TenantIntegration", tenantIntegrationSchema);
