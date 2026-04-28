import { buildClientOrgPathUrl, buildTenantPathUrl } from "@/api/urls/pathBuilder";

// Bank routes split across two scopes:
//  - Realm-scoped (mounted under `clientOrgRouter`): accounts, statements,
//    transactions, vendor-gstins, account-names. Use `buildClientOrgPathUrl`.
//  - Tenant-scoped (mounted under `tenantRouter`): the SSE subscriber for
//    parse-progress broadcasts (one feed per tenant, no clientOrgId filter).
//    Use `buildTenantPathUrl`. The consumer constructs an absolute URL by
//    prepending `apiClient.defaults.baseURL` because EventSource bypasses the
//    axios interceptor — same shape as `subscribeIngestionSSE` (Sub-PR A).
export const bankUrls = {
  accountsList: (): string => buildClientOrgPathUrl("/bank/accounts"),
  accountsCreate: (): string => buildClientOrgPathUrl("/bank/accounts"),
  accountDelete: (id: string): string =>
    buildClientOrgPathUrl(`/bank/accounts/${encodeURIComponent(id)}`),
  accountRefresh: (id: string): string =>
    buildClientOrgPathUrl(`/bank/accounts/${encodeURIComponent(id)}/refresh`),
  statementsList: (): string => buildClientOrgPathUrl("/bank-statements"),
  statementUpload: (): string => buildClientOrgPathUrl("/bank-statements/upload"),
  statementMatches: (statementId: string): string =>
    buildClientOrgPathUrl(`/bank-statements/${encodeURIComponent(statementId)}/matches`),
  statementGstin: (statementId: string): string =>
    buildClientOrgPathUrl(`/bank-statements/${encodeURIComponent(statementId)}/gstin`),
  vendorGstins: (): string => buildClientOrgPathUrl("/bank-statements/vendor-gstins"),
  statementTransactions: (statementId: string): string =>
    buildClientOrgPathUrl(`/bank-statements/${encodeURIComponent(statementId)}/transactions`),
  statementReconcile: (statementId: string): string =>
    buildClientOrgPathUrl(`/bank-statements/${encodeURIComponent(statementId)}/reconcile`),
  transactionMatch: (transactionId: string): string =>
    buildClientOrgPathUrl(`/bank-statements/transactions/${encodeURIComponent(transactionId)}/match`),
  accountNames: (): string => buildClientOrgPathUrl("/bank-statements/account-names"),
  parseSse: (): string => buildTenantPathUrl("/bank-statements/parse/sse")
};
