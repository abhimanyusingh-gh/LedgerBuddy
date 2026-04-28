import { buildTenantPathUrl } from "@/api/urls/pathBuilder";

export const triageUrls = {
  triageList: (): string => buildTenantPathUrl("/invoices/triage"),
  assignClientOrg: (invoiceId: string): string =>
    buildTenantPathUrl(`/invoices/${encodeURIComponent(invoiceId)}/assign-client-org`),
  reject: (invoiceId: string): string =>
    buildTenantPathUrl(`/invoices/${encodeURIComponent(invoiceId)}/reject`)
};
