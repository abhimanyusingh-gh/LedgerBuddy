import { Schema, model, type InferSchemaType } from "mongoose";

const tcsRateChangeSchema = new Schema(
  {
    previousRate: { type: Number, required: true },
    newRate: { type: Number, required: true },
    changedBy: { type: String, required: true },
    changedByName: { type: String, required: true, default: "" },
    changedAt: { type: Date, required: true },
    reason: { type: String, default: null },
    effectiveFrom: { type: Date, required: true }
  },
  { _id: false }
);

const tenantTcsConfigSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    ratePercent: { type: Number, required: true, default: 0 },
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    updatedBy: { type: String, required: true, default: "" },
    enabled: { type: Boolean, required: true, default: false },
    tcsModifyRoles: {
      type: [String],
      required: true,
      default: () => ["TENANT_ADMIN", "ap_clerk", "senior_accountant", "ca", "tax_specialist", "firm_partner", "ops_admin", "audit_clerk"]
    },
    history: { type: [tcsRateChangeSchema], default: [] }
  },
  { timestamps: true }
);

tenantTcsConfigSchema.index({ tenantId: 1 }, { unique: true });

type TenantTcsConfig = InferSchemaType<typeof tenantTcsConfigSchema>;

export const TenantTcsConfigModel = model<TenantTcsConfig>("TenantTcsConfig", tenantTcsConfigSchema);
