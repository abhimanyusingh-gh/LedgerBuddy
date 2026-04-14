import type { Invoice } from "@/types";

export function isInvoiceSelectable(invoice: Invoice): boolean {
  return invoice.status !== "EXPORTED" && invoice.status !== "PENDING";
}

export function isInvoiceRetryable(invoice: Invoice): boolean {
  return invoice.status !== "EXPORTED";
}

export function isInvoiceApprovable(invoice: Invoice): boolean {
  return invoice.status === "PARSED" || invoice.status === "NEEDS_REVIEW" || invoice.status === "AWAITING_APPROVAL";
}

export function hasApprovalWarning(invoice: Invoice): boolean {
  return invoice.status === "FAILED_PARSE" || invoice.status === "FAILED_OCR";
}

export function isInvoiceExportable(invoice: Invoice): boolean {
  return invoice.status === "APPROVED";
}

export function mergeSelectedIds(currentSelectedIds: string[], invoices: Invoice[]): string[] {
  const blockedIds = new Set(invoices.filter((invoice) => !isInvoiceSelectable(invoice)).map((invoice) => invoice._id));
  return currentSelectedIds.filter((selectedId) => !blockedIds.has(selectedId));
}

type RowAction = "approve" | "reingest" | "delete";

export function getAvailableRowActions(invoice: Invoice): RowAction[] {
  const actions: RowAction[] = [];
  if (isInvoiceApprovable(invoice)) actions.push("approve");
  if (isInvoiceRetryable(invoice)) actions.push("reingest");
  if (invoice.status !== "EXPORTED") actions.push("delete");
  return actions;
}

export function removeSelectedIds(currentSelectedIds: string[], idsToRemove: string[]): string[] {
  if (idsToRemove.length === 0) {
    return currentSelectedIds;
  }

  const idsToRemoveSet = new Set(idsToRemove);
  return currentSelectedIds.filter((id) => !idsToRemoveSet.has(id));
}
