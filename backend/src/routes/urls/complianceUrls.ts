export const COMPLIANCE_URL_PATHS = {
  glCodes: "/admin/gl-codes",
  glCodeByCode: "/admin/gl-codes/:code",
  glCodesImportCsv: "/admin/gl-codes/import-csv",
  complianceConfig: "/admin/compliance-config",
  tcsConfig: "/admin/tcs-config",
  tcsConfigRoles: "/admin/tcs-config/roles",
  tcsConfigHistory: "/admin/tcs-config/history",
  vendors: "/vendors",
  vendorById: "/vendors/:id",
  vendorSection197Cert: "/vendors/:id/cert",
  vendorMerge: "/vendors/:id/merge"
} as const;
