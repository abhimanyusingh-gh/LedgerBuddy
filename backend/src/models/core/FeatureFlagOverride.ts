import { Schema, model, type InferSchemaType } from "mongoose";

export const FEATURE_FLAG_OVERRIDE_SCOPE = {
  GLOBAL: "global",
  TENANT: "tenant"
} as const;

type FeatureFlagOverrideScope =
  (typeof FEATURE_FLAG_OVERRIDE_SCOPE)[keyof typeof FEATURE_FLAG_OVERRIDE_SCOPE];

const FEATURE_FLAG_OVERRIDE_SCOPES: readonly FeatureFlagOverrideScope[] =
  Object.values(FEATURE_FLAG_OVERRIDE_SCOPE);

const featureFlagOverrideSchema = new Schema(
  {
    flagName: { type: String, required: true },
    scope: { type: String, enum: FEATURE_FLAG_OVERRIDE_SCOPES, required: true },
    tenantId: { type: String, default: null },
    enabled: { type: Boolean, required: true }
  },
  { timestamps: true }
);

featureFlagOverrideSchema.index(
  { flagName: 1, scope: 1, tenantId: 1 },
  { unique: true }
);

type FeatureFlagOverride = InferSchemaType<typeof featureFlagOverrideSchema>;

export const FeatureFlagOverrideModel = model<FeatureFlagOverride>(
  "FeatureFlagOverride",
  featureFlagOverrideSchema
);
