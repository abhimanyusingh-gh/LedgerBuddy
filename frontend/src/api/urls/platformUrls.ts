export const platformUrls = {
  authToken: (): string => "/auth/token",
  authRefresh: (): string => "/auth/refresh",
  authChangePassword: (): string => "/auth/change-password",
  session: (): string => "/session",
  platformTenantsUsage: (): string => "/platform/tenants/usage",
  platformTenantsOnboardAdmin: (): string => "/platform/tenants/onboard-admin",
  platformTenantEnabled: (tenantId: string): string =>
    `/platform/tenants/${encodeURIComponent(tenantId)}/enabled`,
  complianceTdsRates: (): string => "/compliance/tds-rates",
  complianceTdsSections: (): string => "/compliance/tds-sections",
  complianceRiskSignals: (): string => "/compliance/risk-signals"
};
