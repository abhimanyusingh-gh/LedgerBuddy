import { buildClientOrgPathUrl, buildTenantPathUrl } from "@/api/urls/pathBuilder";

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
