import { authenticatedUrl } from "@/api/client";
import { buildNested } from "@/api/urls/buildNested";

export const invoiceUrls = {
  preview: (invoiceId: string, page = 1): string =>
    authenticatedUrl(buildNested(`/invoices/${invoiceId}/preview`), {
      page: Math.max(1, Math.round(page))
    })
};
