import { authenticatedUrl } from "@/api/client";
import { buildClientOrgPathUrl } from "@/api/urls/pathBuilder";

export const invoiceUrls = {
  list: (): string => buildClientOrgPathUrl("/invoices"),
  detail: (invoiceId: string): string => buildClientOrgPathUrl(`/invoices/${invoiceId}`),
  update: (invoiceId: string): string => buildClientOrgPathUrl(`/invoices/${invoiceId}`),
  approve: (): string => buildClientOrgPathUrl("/invoices/approve"),
  workflowApprove: (invoiceId: string): string =>
    buildClientOrgPathUrl(`/invoices/${invoiceId}/workflow-approve`),
  workflowReject: (invoiceId: string): string =>
    buildClientOrgPathUrl(`/invoices/${invoiceId}/workflow-reject`),
  bulkDelete: (): string => buildClientOrgPathUrl("/invoices/delete"),
  retry: (): string => buildClientOrgPathUrl("/invoices/retry"),
  preview: (invoiceId: string, page = 1): string =>
    authenticatedUrl(buildClientOrgPathUrl(`/invoices/${invoiceId}/preview`), {
      page: Math.max(1, Math.round(page))
    })
};
