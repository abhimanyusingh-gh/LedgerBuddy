import { buildClientOrgPathUrl } from "@/api/urls/pathBuilder";

export const complianceUrls = {
  vendorsList: (): string => buildClientOrgPathUrl("/vendors"),
  vendorUpdate: (id: string): string =>
    buildClientOrgPathUrl(`/vendors/${encodeURIComponent(id)}`),
  glCodesList: (): string => buildClientOrgPathUrl("/admin/gl-codes"),
  glCodesCreate: (): string => buildClientOrgPathUrl("/admin/gl-codes"),
  glCodeUpdate: (code: string): string =>
    buildClientOrgPathUrl(`/admin/gl-codes/${encodeURIComponent(code)}`),
  glCodeDelete: (code: string): string =>
    buildClientOrgPathUrl(`/admin/gl-codes/${encodeURIComponent(code)}`),
  glCodesImportCsv: (): string => buildClientOrgPathUrl("/admin/gl-codes/import-csv"),
  complianceConfig: (): string => buildClientOrgPathUrl("/admin/compliance-config"),
  notificationConfig: (): string => buildClientOrgPathUrl("/admin/notification-config"),
  tcsConfig: (): string => buildClientOrgPathUrl("/admin/tcs-config"),
  tcsConfigRoles: (): string => buildClientOrgPathUrl("/admin/tcs-config/roles"),
  tcsConfigHistory: (): string => buildClientOrgPathUrl("/admin/tcs-config/history"),
  approvalWorkflow: (): string => buildClientOrgPathUrl("/admin/approval-workflow"),
  approvalLimits: (): string => buildClientOrgPathUrl("/admin/approval-limits")
};
