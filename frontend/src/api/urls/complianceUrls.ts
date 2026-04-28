import { buildClientOrgPathUrl } from "@/api/urls/pathBuilder";

// All compliance endpoints exposed here are realm-scoped (mounted under
// `clientOrgRouter` in `app.ts`: vendors, GL codes, TCS config, client
// compliance config, notification config, approval workflow + limits).
// The unscoped statutory-metadata routes (`/compliance/tds-rates`,
// `/compliance/tds-sections`, `/compliance/risk-signals`) stay on the legacy
// `/api` mount: they have no tenantId/clientOrgId in the path (handlers read
// no tenant context — pure global reference data) and the FE callers in
// `admin.ts` invoke them via the bare path, bypassing the rewriter.
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
