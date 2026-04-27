import { authenticatedUrl } from "@/api/client";
import { buildNested } from "@/api/urls/buildNested";

export const invoiceUrls = {
  list: (): string => buildNested("/invoices"),
  detail: (invoiceId: string): string => buildNested(`/invoices/${invoiceId}`),
  update: (invoiceId: string): string => buildNested(`/invoices/${invoiceId}`),
  approve: (): string => buildNested("/invoices/approve"),
  workflowApprove: (invoiceId: string): string =>
    buildNested(`/invoices/${invoiceId}/workflow-approve`),
  workflowReject: (invoiceId: string): string =>
    buildNested(`/invoices/${invoiceId}/workflow-reject`),
  bulkDelete: (): string => buildNested("/invoices/delete"),
  retry: (): string => buildNested("/invoices/retry"),
  preview: (invoiceId: string, page = 1): string =>
    authenticatedUrl(buildNested(`/invoices/${invoiceId}/preview`), {
      page: Math.max(1, Math.round(page))
    })
};
