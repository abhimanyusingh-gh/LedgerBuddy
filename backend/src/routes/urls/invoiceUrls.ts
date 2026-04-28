export const INVOICE_URL_PATHS = {
  list: "/invoices",
  detail: "/invoices/:id",
  update: "/invoices/:id",
  approve: "/invoices/approve",
  retry: "/invoices/retry",
  bulkDelete: "/invoices/delete",
  retriggerCompliance: "/invoices/:id/retrigger-compliance",
  preview: "/invoices/:id/preview",
  actionRequired: "/invoices/action-required",
  workflowApprove: "/invoices/:id/workflow-approve",
  workflowReject: "/invoices/:id/workflow-reject",
  adminApprovalLimits: "/admin/approval-limits",
  adminApprovalWorkflow: "/admin/approval-workflow",
  analyticsOverview: "/analytics/overview"
} as const;
