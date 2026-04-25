import { apiClient, authenticatedUrl, safeNum, stripNulls } from "@/api/client";
import type { Invoice, InvoiceListResponse, TallyFileExportResponse, ExportHistoryResponse } from "@/types";

interface UpdateInvoiceParsedPayload {
  parsed: Partial<{
    invoiceNumber: string | null;
    vendorName: string | null;
    invoiceDate: string | null;
    dueDate: string | null;
    currency: string | null;
    totalAmountMajor: string | number | null;
    totalAmountMinor: number | null;
    notes: string[] | null;
    gst: Record<string, number | string | null>;
  }>;
  updatedBy?: string;
}

export async function uploadInvoiceFiles(files: File[]): Promise<{ uploaded: string[]; count: number }> {
  const formData = new FormData();
  for (const file of files) formData.append("files", file);
  return (await apiClient.post<{ uploaded: string[]; count: number }>("/jobs/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  })).data;
}

interface FetchInvoicesOptions {
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  approvedBy?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export async function fetchInvoices(options: FetchInvoicesOptions = {}) {
  const { status, from, to, page = 1, limit = 20, approvedBy, sortBy, sortDir } = options;
  const response = await apiClient.get<InvoiceListResponse>("/invoices", {
    params: {
      page, limit,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      approvedBy: approvedBy || undefined,
      sortBy: sortBy || undefined,
      sortDir: sortBy ? sortDir : undefined
    }
  });
  const data = stripNulls(response.data) as Partial<InvoiceListResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: safeNum(data.page, 1), limit: safeNum(data.limit, 0), total: safeNum(data.total, 0),
    totalAll: safeNum(data.totalAll!, undefined!), approvedAll: safeNum(data.approvedAll!, undefined!),
    pendingAll: safeNum(data.pendingAll!, undefined!), failedAll: safeNum(data.failedAll!, undefined!),
    needsReviewAll: safeNum(data.needsReviewAll!, undefined!), parsedAll: safeNum(data.parsedAll!, undefined!),
    awaitingApprovalAll: safeNum(data.awaitingApprovalAll!, undefined!), failedOcrAll: safeNum(data.failedOcrAll!, undefined!),
    failedParseAll: safeNum(data.failedParseAll!, undefined!), exportedAll: safeNum(data.exportedAll!, undefined!)
  };
}

export async function fetchInvoiceById(invoiceId: string) {
  return stripNulls((await apiClient.get<Invoice>(`/invoices/${invoiceId}`)).data) as Invoice;
}

export function getInvoicePreviewUrl(invoiceId: string, page = 1): string {
  return authenticatedUrl(`/invoices/${invoiceId}/preview`, { page: Math.max(1, Math.round(page)) });
}

export async function approveInvoices(ids: string[], approvedBy: string) {
  return (await apiClient.post<{ modifiedCount: number }>("/invoices/approve", { ids, approvedBy })).data;
}

export async function approveWorkflowStep(invoiceId: string) {
  return (await apiClient.post(`/invoices/${invoiceId}/workflow-approve`)).data;
}

export async function rejectWorkflowStep(invoiceId: string, reason: string) {
  return (await apiClient.post(`/invoices/${invoiceId}/workflow-reject`, { reason })).data;
}

export async function deleteInvoices(ids: string[]) {
  return (await apiClient.post<{ deletedCount: number }>("/invoices/delete", { ids })).data;
}

export async function retryInvoices(ids: string[]) {
  return (await apiClient.post<{ modifiedCount: number }>("/invoices/retry", { ids })).data;
}

export async function generateTallyXmlFile(ids?: string[]) {
  return (await apiClient.post<TallyFileExportResponse>("/exports/tally/download", { ids })).data;
}

export async function downloadTallyXmlFile(batchId: string): Promise<Blob> {
  return (await apiClient.get(`/exports/tally/download/${batchId}`, { responseType: "blob" })).data as Blob;
}

export async function fetchExportHistory(page = 1, limit = 20): Promise<ExportHistoryResponse> {
  const data = stripNulls((await apiClient.get<ExportHistoryResponse>("/exports/tally/history", { params: { page, limit } })).data) as Partial<ExportHistoryResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: safeNum(data.page, 1), limit: safeNum(data.limit, 20), total: safeNum(data.total, 0)
  };
}

export async function updateInvoiceParsedFields(invoiceId: string, payload: UpdateInvoiceParsedPayload) {
  return stripNulls((await apiClient.patch<Invoice>(`/invoices/${invoiceId}`, payload)).data) as Invoice;
}

export async function updateInvoiceComplianceOverride(invoiceId: string, payload: Record<string, unknown>): Promise<Invoice> {
  return stripNulls((await apiClient.patch<Invoice>(`/invoices/${invoiceId}`, payload)).data) as Invoice;
}


export async function renameInvoiceAttachment(invoiceId: string, attachmentName: string) {
  return stripNulls((await apiClient.patch<Invoice>(`/invoices/${invoiceId}`, { attachmentName })).data) as Invoice;
}
