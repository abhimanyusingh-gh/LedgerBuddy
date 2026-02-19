import { shouldAutoSelectInvoice } from "./confidence";
import type { Invoice } from "./types";

export function isInvoiceSelectable(invoice: Invoice): boolean {
  return invoice.status !== "EXPORTED";
}

export function isInvoiceApprovable(invoice: Invoice): boolean {
  return invoice.status === "PARSED" || invoice.status === "NEEDS_REVIEW" || invoice.status === "FAILED_PARSE";
}

export function isInvoiceExportable(invoice: Invoice): boolean {
  return invoice.status === "APPROVED";
}

export function mergeSelectedIds(currentSelectedIds: string[], invoices: Invoice[]): string[] {
  const blockedIds = new Set(invoices.filter((invoice) => !isInvoiceSelectable(invoice)).map((invoice) => invoice._id));
  const persistedSelectedIds = currentSelectedIds.filter((selectedId) => !blockedIds.has(selectedId));
  const autoSelectedIds = invoices
    .filter((invoice) => isInvoiceSelectable(invoice) && shouldAutoSelectInvoice(invoice))
    .map((invoice) => invoice._id);

  return Array.from(new Set([...persistedSelectedIds, ...autoSelectedIds]));
}

export function removeSelectedIds(currentSelectedIds: string[], idsToRemove: string[]): string[] {
  if (idsToRemove.length === 0) {
    return currentSelectedIds;
  }

  const idsToRemoveSet = new Set(idsToRemove);
  return currentSelectedIds.filter((id) => !idsToRemoveSet.has(id));
}
