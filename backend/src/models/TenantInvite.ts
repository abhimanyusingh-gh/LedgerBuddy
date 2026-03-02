import { Schema, model, type InferSchemaType } from "mongoose";

const tenantInviteSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    email: { type: String, required: true },
    tokenHash: { type: String, required: true },
    role: { type: String, enum: ["MEMBER"], required: true, default: "MEMBER" },
    invitedByUserId: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

tenantInviteSchema.index({ tokenHash: 1 }, { unique: true });
tenantInviteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type TenantInvite = InferSchemaType<typeof tenantInviteSchema>;

export const TenantInviteModel = model<TenantInvite>("TenantInvite", tenantInviteSchema);
