import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

// Triage paths route through tenant-scoped bypass (PENDING_TRIAGE invoices
// carry clientOrgId: null per #156); the BE mounts them under tenantRouter.
// Kept in a separate provider from invoiceUrls so the realm-vs-tenant scoping
// difference is not a footgun for future contributors.
export const triageUrls = {
  triageList: (): string => buildTenantPathUrl("/invoices/triage"),
  assignClientOrg: (invoiceId: string): string =>
    buildTenantPathUrl(`/invoices/${encodeURIComponent(invoiceId)}/assign-client-org`),
  reject: (invoiceId: string): string =>
    buildTenantPathUrl(`/invoices/${encodeURIComponent(invoiceId)}/reject`)
};
