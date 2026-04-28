export const TRIAGE_URL_PATHS = {
  list: "/invoices/triage",
  assignClientOrg: "/invoices/:id/assign-client-org",
  reject: "/invoices/:id/reject"
} as const;
