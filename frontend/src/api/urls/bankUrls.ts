import { buildNested } from "@/api/urls/buildNested";

// All bank routes covered here are realm-scoped (mounted under `clientOrgRouter`
// in `app.ts`). The SSE subscriber endpoint `/bank-statements/parse/sse` lives
// on the legacy unscoped `/api` mount (it bypasses the axios interceptor via
// EventSource) and therefore stays out of this provider until the legacy mount
// is retired.
export const bankUrls = {
  accountsList: (): string => buildNested("/bank/accounts"),
  accountsCreate: (): string => buildNested("/bank/accounts"),
  accountDelete: (id: string): string =>
    buildNested(`/bank/accounts/${encodeURIComponent(id)}`),
  accountRefresh: (id: string): string =>
    buildNested(`/bank/accounts/${encodeURIComponent(id)}/refresh`),
  statementsList: (): string => buildNested("/bank-statements"),
  statementUpload: (): string => buildNested("/bank-statements/upload"),
  statementMatches: (statementId: string): string =>
    buildNested(`/bank-statements/${encodeURIComponent(statementId)}/matches`),
  statementGstin: (statementId: string): string =>
    buildNested(`/bank-statements/${encodeURIComponent(statementId)}/gstin`),
  vendorGstins: (): string => buildNested("/bank-statements/vendor-gstins"),
  statementTransactions: (statementId: string): string =>
    buildNested(`/bank-statements/${encodeURIComponent(statementId)}/transactions`),
  statementReconcile: (statementId: string): string =>
    buildNested(`/bank-statements/${encodeURIComponent(statementId)}/reconcile`),
  transactionMatch: (transactionId: string): string =>
    buildNested(`/bank-statements/transactions/${encodeURIComponent(transactionId)}/match`),
  accountNames: (): string => buildNested("/bank-statements/account-names")
};
