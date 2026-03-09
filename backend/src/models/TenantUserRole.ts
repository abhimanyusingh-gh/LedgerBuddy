import { Schema, model, type InferSchemaType } from "mongoose";

export const TenantRoles = ["TENANT_ADMIN", "MEMBER"] as const;
export type TenantRole = (typeof TenantRoles)[number];

const tenantUserRoleSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: TenantRoles, required: true }
  },
  {
    timestamps: true
  }
);

tenantUserRoleSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
tenantUserRoleSchema.index({ tenantId: 1, role: 1 });

type TenantUserRole = InferSchemaType<typeof tenantUserRoleSchema>;

export const TenantUserRoleModel = model<TenantUserRole>("TenantUserRole", tenantUserRoleSchema);
