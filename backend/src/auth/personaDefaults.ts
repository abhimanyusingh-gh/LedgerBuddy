import { normalizeTenantRole, type ActiveTenantRole } from "@/models/core/TenantUserRole.js";

export interface UserCapabilities {
  approvalLimitMinor: number | null;
  canApproveInvoices: boolean;
  canEditInvoiceFields: boolean;
  canDeleteInvoices: boolean;
  canRetryInvoices: boolean;
  canUploadFiles: boolean;
  canStartIngestion: boolean;
  canOverrideTds: boolean;
  canOverrideGlCode: boolean;
  canSignOffCompliance: boolean;
  canConfigureTdsMappings: boolean;
  canConfigureGlCodes: boolean;
  canManageUsers: boolean;
  canManageConnections: boolean;
  canExportToTally: boolean;
  canExportToCsv: boolean;
  canDownloadComplianceReports: boolean;
  canViewAllInvoices: boolean;
  canConfigureWorkflow: boolean;
  canConfigureCompliance: boolean;
  canManageCostCenters: boolean;
  canSendVendorEmails: boolean;
}

const ALL_TRUE: UserCapabilities = {
  approvalLimitMinor: null,
  canApproveInvoices: true,
  canEditInvoiceFields: true,
  canDeleteInvoices: true,
  canRetryInvoices: true,
  canUploadFiles: true,
  canStartIngestion: true,
  canOverrideTds: true,
  canOverrideGlCode: true,
  canSignOffCompliance: true,
  canConfigureTdsMappings: true,
  canConfigureGlCodes: true,
  canManageUsers: true,
  canManageConnections: true,
  canExportToTally: true,
  canExportToCsv: true,
  canDownloadComplianceReports: true,
  canViewAllInvoices: true,
  canConfigureWorkflow: true,
  canConfigureCompliance: true,
  canManageCostCenters: true,
  canSendVendorEmails: true
};

const ALL_FALSE: UserCapabilities = {
  approvalLimitMinor: 0,
  canApproveInvoices: false,
  canEditInvoiceFields: false,
  canDeleteInvoices: false,
  canRetryInvoices: false,
  canUploadFiles: false,
  canStartIngestion: false,
  canOverrideTds: false,
  canOverrideGlCode: false,
  canSignOffCompliance: false,
  canConfigureTdsMappings: false,
  canConfigureGlCodes: false,
  canManageUsers: false,
  canManageConnections: false,
  canExportToTally: false,
  canExportToCsv: false,
  canDownloadComplianceReports: false,
  canViewAllInvoices: false,
  canConfigureWorkflow: false,
  canConfigureCompliance: false,
  canManageCostCenters: false,
  canSendVendorEmails: false
};

type CapabilityRole = Exclude<ActiveTenantRole, "PLATFORM_ADMIN"> | "PLATFORM_ADMIN";

const ROLE_DEFAULTS: Record<CapabilityRole, UserCapabilities> = {
  PLATFORM_ADMIN: { ...ALL_FALSE },
  TENANT_ADMIN: { ...ALL_TRUE },
  ap_clerk: {
    ...ALL_FALSE,
    approvalLimitMinor: 10000000,
    canApproveInvoices: true,
    canEditInvoiceFields: true,
    canDeleteInvoices: true,
    canRetryInvoices: true,
    canUploadFiles: true,
    canStartIngestion: true,
    canOverrideGlCode: true,
    canExportToTally: true,
    canExportToCsv: true,
    canSendVendorEmails: true
  },
  senior_accountant: {
    ...ALL_FALSE,
    approvalLimitMinor: 100000000,
    canApproveInvoices: true,
    canEditInvoiceFields: true,
    canDeleteInvoices: true,
    canRetryInvoices: true,
    canUploadFiles: true,
    canStartIngestion: true,
    canOverrideTds: true,
    canOverrideGlCode: true,
    canConfigureGlCodes: true,
    canExportToTally: true,
    canExportToCsv: true,
    canDownloadComplianceReports: true,
    canManageCostCenters: true,
    canSendVendorEmails: true
  },
  ca: {
    ...ALL_TRUE,
    canManageUsers: false,
    canManageConnections: false
  },
  tax_specialist: {
    ...ALL_FALSE,
    canEditInvoiceFields: true,
    canOverrideTds: true,
    canOverrideGlCode: true,
    canConfigureTdsMappings: true,
    canConfigureGlCodes: true,
    canDownloadComplianceReports: true,
    canViewAllInvoices: true,
    canConfigureCompliance: true,
    canManageCostCenters: true
  },
  firm_partner: {
    ...ALL_TRUE,
    canManageConnections: false
  },
  ops_admin: {
    ...ALL_FALSE,
    canManageUsers: true,
    canManageConnections: true,
    canStartIngestion: true
  },
  audit_clerk: {
    ...ALL_FALSE,
    canDownloadComplianceReports: true,
    canViewAllInvoices: true
  }
};

export function getRoleDefaults(role: string): UserCapabilities {
  const normalized = normalizeTenantRole(role) as CapabilityRole;
  return { ...ROLE_DEFAULTS[normalized] };
}

export function mergeCapabilitiesWithDefaults(
  role: string,
  storedCaps: Record<string, unknown> | null | undefined
): UserCapabilities {
  const defaults = getRoleDefaults(role);
  if (!storedCaps) {
    return defaults;
  }
  const filtered = Object.fromEntries(
    Object.entries(storedCaps).filter(([, value]) => value !== undefined && value !== null)
  );
  return { ...defaults, ...filtered } as UserCapabilities;
}

export function applyApprovalLimitOverrides(
  capabilities: UserCapabilities,
  role: string,
  overrides: Record<string, number> | undefined | null
): UserCapabilities {
  if (!overrides) return capabilities;
  const normalized = normalizeTenantRole(role);
  const overrideValue = overrides[normalized];
  if (overrideValue === undefined) return capabilities;
  return { ...capabilities, approvalLimitMinor: overrideValue };
}
