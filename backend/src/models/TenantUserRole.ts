import { Schema, model, type InferSchemaType } from "mongoose";

const PersonaRoles = [
  "ap_clerk",
  "senior_accountant",
  "ca",
  "tax_specialist",
  "firm_partner",
  "ops_admin",
  "audit_clerk"
] as const;
export const TenantAssignableRoles = ["TENANT_ADMIN", ...PersonaRoles] as const;
export type TenantAssignableRole = (typeof TenantAssignableRoles)[number];

export const ActiveTenantRoles = ["PLATFORM_ADMIN", ...TenantAssignableRoles] as const;
export type ActiveTenantRole = (typeof ActiveTenantRoles)[number];

export const TenantRoles = [...ActiveTenantRoles] as const;
export type TenantRole = (typeof TenantRoles)[number];

export function normalizeTenantRole(role: string): ActiveTenantRole {
  if ((ActiveTenantRoles as readonly string[]).includes(role)) {
    return role as ActiveTenantRole;
  }
  throw new Error(`Unknown tenant role: ${role}`);
}

const userCapabilitiesSchema = new Schema(
  {
    approvalLimitMinor: { type: Number, default: null },
    canApproveInvoices: { type: Boolean, default: false },
    canEditInvoiceFields: { type: Boolean, default: false },
    canDeleteInvoices: { type: Boolean, default: false },
    canRetryInvoices: { type: Boolean, default: false },
    canUploadFiles: { type: Boolean, default: false },
    canStartIngestion: { type: Boolean, default: false },
    canOverrideTds: { type: Boolean, default: false },
    canOverrideGlCode: { type: Boolean, default: false },
    canSignOffCompliance: { type: Boolean, default: false },
    canConfigureTdsMappings: { type: Boolean, default: false },
    canConfigureGlCodes: { type: Boolean, default: false },
    canManageUsers: { type: Boolean, default: false },
    canManageConnections: { type: Boolean, default: false },
    canExportToTally: { type: Boolean, default: false },
    canExportToCsv: { type: Boolean, default: false },
    canDownloadComplianceReports: { type: Boolean, default: false },
    canViewAllInvoices: { type: Boolean, default: false },
    canConfigureWorkflow: { type: Boolean, default: false },
    canConfigureCompliance: { type: Boolean, default: false },
    canManageCostCenters: { type: Boolean, default: false },
    canSendVendorEmails: { type: Boolean, default: false }
  },
  { _id: false }
);

const tenantUserRoleSchema = new Schema(
  {
    tenantId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: TenantRoles, required: true },
    capabilities: { type: userCapabilitiesSchema, default: () => ({}) }
  },
  {
    timestamps: true
  }
);

tenantUserRoleSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
tenantUserRoleSchema.index({ tenantId: 1, role: 1 });

type TenantUserRole = InferSchemaType<typeof tenantUserRoleSchema>;

export const TenantUserRoleModel = model<TenantUserRole>("TenantUserRole", tenantUserRoleSchema);
