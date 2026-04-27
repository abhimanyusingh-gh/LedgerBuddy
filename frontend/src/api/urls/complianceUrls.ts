import { buildNested } from "@/api/urls/buildNested";

// All compliance endpoints exposed here are realm-scoped (mounted under
// `clientOrgRouter` in `app.ts`: vendors, GL codes, TCS config, client
// compliance config, notification config). The unscoped metadata routes
// (`/compliance/tds-rates`, `/compliance/tds-sections`, `/compliance/risk-signals`)
// stay on the legacy `/api` mount and remain bare-path callers until that
// mount is retired in a later sub-PR.
export const complianceUrls = {
  vendorsList: (): string => buildNested("/vendors"),
  vendorUpdate: (id: string): string =>
    buildNested(`/vendors/${encodeURIComponent(id)}`),
  glCodesList: (): string => buildNested("/admin/gl-codes"),
  glCodesCreate: (): string => buildNested("/admin/gl-codes"),
  glCodeUpdate: (code: string): string =>
    buildNested(`/admin/gl-codes/${encodeURIComponent(code)}`),
  glCodeDelete: (code: string): string =>
    buildNested(`/admin/gl-codes/${encodeURIComponent(code)}`),
  glCodesImportCsv: (): string => buildNested("/admin/gl-codes/import-csv"),
  complianceConfig: (): string => buildNested("/admin/compliance-config"),
  notificationConfig: (): string => buildNested("/admin/notification-config"),
  tcsConfig: (): string => buildNested("/admin/tcs-config"),
  tcsConfigRoles: (): string => buildNested("/admin/tcs-config/roles"),
  tcsConfigHistory: (): string => buildNested("/admin/tcs-config/history")
};
