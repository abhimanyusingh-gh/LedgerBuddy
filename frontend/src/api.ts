import axios from "axios";
import type { IngestionJobStatus, Invoice, InvoiceListResponse, TallyExportResponse } from "./types";

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api"
});

export async function fetchInvoices(status?: string) {
  const pageSize = 100;
  let page = 1;
  let total = 0;
  const items: Invoice[] = [];

  while (true) {
    const response = await apiClient.get<InvoiceListResponse>("/invoices", {
      params: {
        page,
        limit: pageSize,
        status: status || undefined
      }
    });

    const data = sanitizeInvoiceListResponse(response.data);
    if (page === 1) {
      total = data.total;
    }

    items.push(...data.items);

    if (data.items.length === 0 || items.length >= total || data.items.length < pageSize) {
      break;
    }

    page += 1;
  }

  return {
    items,
    page: 1,
    limit: items.length,
    total: total || items.length
  };
}

export async function approveInvoices(ids: string[], approvedBy: string) {
  const response = await apiClient.post<{ modifiedCount: number }>("/invoices/approve", {
    ids,
    approvedBy
  });

  return response.data;
}

export async function exportToTally(ids?: string[]) {
  const response = await apiClient.post<TallyExportResponse>("/exports/tally", {
    ids,
    requestedBy: "ui"
  });

  return response.data;
}

export async function runIngestion() {
  const response = await apiClient.post<IngestionJobStatus>("/jobs/ingest");
  return sanitizeIngestionStatus(response.data);
}

export async function fetchIngestionStatus() {
  const response = await apiClient.get<IngestionJobStatus>("/jobs/ingest/status");
  return sanitizeIngestionStatus(response.data);
}

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
  }>;
  updatedBy?: string;
}

export async function updateInvoiceParsedFields(invoiceId: string, payload: UpdateInvoiceParsedPayload) {
  const response = await apiClient.patch<Invoice>(`/invoices/${invoiceId}`, payload);
  return stripNulls(response.data) as Invoice;
}

function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => stripNulls(entry)).filter((entry) => entry !== undefined);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const sanitized = stripNulls(rawValue);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sanitizeInvoiceListResponse(value: unknown): InvoiceListResponse {
  const data = stripNulls(value) as Partial<InvoiceListResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: typeof data.page === "number" && Number.isFinite(data.page) ? data.page : 1,
    limit: typeof data.limit === "number" && Number.isFinite(data.limit) ? data.limit : 0,
    total: typeof data.total === "number" && Number.isFinite(data.total) ? data.total : 0
  };
}

function sanitizeIngestionStatus(value: unknown): IngestionJobStatus {
  const data = stripNulls(value) as Partial<IngestionJobStatus>;
  return {
    state:
      data.state === "running" || data.state === "completed" || data.state === "failed" || data.state === "idle"
        ? data.state
        : "idle",
    running: data.running === true,
    totalFiles: typeof data.totalFiles === "number" && Number.isFinite(data.totalFiles) ? data.totalFiles : 0,
    processedFiles:
      typeof data.processedFiles === "number" && Number.isFinite(data.processedFiles) ? data.processedFiles : 0,
    newInvoices: typeof data.newInvoices === "number" && Number.isFinite(data.newInvoices) ? data.newInvoices : 0,
    duplicates: typeof data.duplicates === "number" && Number.isFinite(data.duplicates) ? data.duplicates : 0,
    failures: typeof data.failures === "number" && Number.isFinite(data.failures) ? data.failures : 0,
    startedAt: typeof data.startedAt === "string" ? data.startedAt : undefined,
    completedAt: typeof data.completedAt === "string" ? data.completedAt : undefined,
    error: typeof data.error === "string" ? data.error : undefined,
    lastUpdatedAt: typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt : new Date(0).toISOString()
  };
}
