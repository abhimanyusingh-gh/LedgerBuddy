import axios from "axios";
import type {
  ExportHistoryResponse,
  GmailConnectionStatus,
  IngestionJobStatus,
  Invoice,
  InvoiceListResponse,
  TallyExportResponse,
  TallyFileExportResponse
} from "./types";
import { normalizeApiError } from "./apiError";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4100/api";
const SESSION_TOKEN_KEY = "billforge_session_token";

const apiClient = axios.create({ baseURL: apiBaseUrl });

apiClient.interceptors.request.use((config) => {
  const token = getStoredSessionToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeApiError(error))
);


interface SessionContextResponse {
  user: {
    id: string;
    email: string;
    role: "TENANT_ADMIN" | "MEMBER";
    isPlatformAdmin: boolean;
  };
  tenant: {
    id: string;
    name: string;
    onboarding_status: "pending" | "completed";
    mode?: "test" | "live";
  };
  flags: {
    requires_tenant_setup: boolean;
    requires_reauth: boolean;
    requires_admin_action: boolean;
    requires_email_confirmation: boolean;
  };
}

interface TenantUserSummary {
  userId: string;
  email: string;
  role: "TENANT_ADMIN" | "MEMBER";
}

export interface PlatformTenantUsageSummary {
  tenantId: string;
  tenantName: string;
  onboardingStatus: "pending" | "completed";
  userCount: number;
  totalDocuments: number;
  parsedDocuments: number;
  approvedDocuments: number;
  exportedDocuments: number;
  needsReviewDocuments: number;
  failedDocuments: number;
  gmailConnectionState: "CONNECTED" | "NEEDS_REAUTH" | "DISCONNECTED";
  lastIngestedAt: string | null;
  createdAt: string;
  adminTempPassword?: string;
  adminEmail?: string;
  ocrTokensTotal: number;
  slmTokensTotal: number;
}

interface PlatformTenantOnboardResult {
  tenantId: string;
  tenantName: string;
  adminUserId: string;
  adminEmail: string;
  tempPassword?: string;
}

export function getStoredSessionToken(): string {
  return window.localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

export function setStoredSessionToken(token: string): void {
  const normalized = token.trim();
  if (normalized.length === 0) {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_TOKEN_KEY, normalized);
}

export function clearStoredSessionToken(): void {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

export async function loginWithCredentials(email: string, password: string): Promise<string> {
  const response = await apiClient.post<{ token?: string }>("/auth/token", {
    email,
    password
  });
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) {
    throw new Error("Login did not return a session token.");
  }
  return token;
}

export async function fetchSessionContext(): Promise<SessionContextResponse> {
  const response = await apiClient.get<SessionContextResponse>("/session");
  return response.data;
}

export async function completeTenantOnboarding(payload: { tenantName: string; adminEmail: string }): Promise<void> {
  await apiClient.post("/tenant/onboarding/complete", payload);
}

export async function fetchTenantUsers(): Promise<TenantUserSummary[]> {
  const response = await apiClient.get<{ items?: TenantUserSummary[] }>("/admin/users");
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function inviteTenantUser(email: string): Promise<void> {
  await apiClient.post("/admin/users/invite", { email });
}

export async function assignTenantUserRole(userId: string, role: "TENANT_ADMIN" | "MEMBER"): Promise<void> {
  await apiClient.post(`/admin/users/${userId}/role`, { role });
}

export async function removeTenantUser(userId: string): Promise<void> {
  await apiClient.delete(`/admin/users/${userId}`);
}

export async function fetchPlatformTenantUsage(): Promise<PlatformTenantUsageSummary[]> {
  const response = await apiClient.get<{ items?: PlatformTenantUsageSummary[] }>("/platform/tenants/usage");
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function onboardTenantAdmin(payload: {
  tenantName: string;
  adminEmail: string;
  adminDisplayName?: string;
  mode?: string;
}): Promise<PlatformTenantOnboardResult> {
  const response = await apiClient.post<PlatformTenantOnboardResult>("/platform/tenants/onboard-admin", payload);
  return response.data;
}

export async function uploadInvoiceFiles(files: File[]): Promise<{ uploaded: string[]; count: number }> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const response = await apiClient.post<{ uploaded: string[]; count: number }>("/jobs/upload", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  });
  return response.data;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/change-password", { currentPassword, newPassword });
}

export async function fetchInvoices(status?: string) {
  const pageSize = 100;
  let page = 1;
  let total = 0;
  let totalAll: number | undefined;
  let approvedAll: number | undefined;
  let pendingAll: number | undefined;
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
      totalAll = data.totalAll;
      approvedAll = data.approvedAll;
      pendingAll = data.pendingAll;
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
    total: total || items.length,
    totalAll,
    approvedAll,
    pendingAll
  };
}

export async function fetchInvoiceById(invoiceId: string) {
  const response = await apiClient.get<Invoice>(`/invoices/${invoiceId}`);
  return stripNulls(response.data) as Invoice;
}

export function getInvoiceBlockCropUrl(invoiceId: string, blockIndex: number): string {
  const raw = apiClient.getUri({
    url: `/invoices/${invoiceId}/ocr-blocks/${blockIndex}/crop`
  });
  return appendAuthTokenQuery(raw);
}

export function getInvoiceFieldOverlayUrl(invoiceId: string, field: string): string {
  const raw = apiClient.getUri({
    url: `/invoices/${invoiceId}/source-overlays/${field}`
  });
  return appendAuthTokenQuery(raw);
}

export function getInvoicePreviewUrl(invoiceId: string, page = 1): string {
  const raw = apiClient.getUri({
    url: `/invoices/${invoiceId}/preview`,
    params: {
      page: Math.max(1, Math.round(page))
    }
  });
  return appendAuthTokenQuery(raw);
}

export async function approveInvoices(ids: string[], approvedBy: string) {
  const response = await apiClient.post<{ modifiedCount: number }>("/invoices/approve", {
    ids,
    approvedBy
  });

  return response.data;
}

export async function deleteInvoices(ids: string[]) {
  const response = await apiClient.post<{ deletedCount: number }>("/invoices/delete", { ids });
  return response.data;
}

export async function retryInvoices(ids: string[]) {
  const response = await apiClient.post<{ modifiedCount: number }>("/invoices/retry", { ids });
  return response.data;
}

export async function exportToTally(ids?: string[]) {
  const response = await apiClient.post<TallyExportResponse>("/exports/tally", {
    ids,
    requestedBy: "ui"
  });

  return response.data;
}

export async function generateTallyXmlFile(ids?: string[]) {
  const response = await apiClient.post<TallyFileExportResponse>("/exports/tally/download", {
    ids,
    requestedBy: "ui"
  });
  return response.data;
}

export async function downloadTallyXmlFile(batchId: string): Promise<Blob> {
  const response = await apiClient.get(`/exports/tally/download/${batchId}`, {
    responseType: "blob"
  });
  return response.data as Blob;
}

export async function fetchExportHistory(page = 1, limit = 20): Promise<ExportHistoryResponse> {
  const response = await apiClient.get<ExportHistoryResponse>("/exports/tally/history", {
    params: { page, limit }
  });
  return sanitizeExportHistoryResponse(response.data);
}

function safeNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function safeStr(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function sanitizeExportHistoryResponse(value: unknown): ExportHistoryResponse {
  const data = stripNulls(value) as Partial<ExportHistoryResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: safeNum(data.page, 1), limit: safeNum(data.limit, 20), total: safeNum(data.total, 0)
  };
}

export async function runIngestion() {
  const response = await apiClient.post<IngestionJobStatus>("/jobs/ingest");
  return sanitizeIngestionStatus(response.data);
}



export async function pauseIngestion() {
  const response = await apiClient.post<IngestionJobStatus>("/jobs/ingest/pause");
  return sanitizeIngestionStatus(response.data);
}

export async function fetchIngestionStatus() {
  const response = await apiClient.get<IngestionJobStatus>("/jobs/ingest/status");
  return sanitizeIngestionStatus(response.data);
}

export async function fetchGmailConnectionStatus() {
  const response = await apiClient.get<GmailConnectionStatus>("/integrations/gmail");
  return sanitizeGmailConnectionStatus(response.data);
}

export async function fetchGmailConnectUrl(): Promise<string> {
  const response = await apiClient.get<{ connectUrl: string }>("/integrations/gmail/connect-url");
  const connectUrl = typeof response.data?.connectUrl === "string" ? response.data.connectUrl.trim() : "";
  if (!connectUrl) {
    throw new Error("Gmail connect URL was not returned.");
  }
  return connectUrl;
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
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((e) => (e == null ? e : stripNulls(e)));
  if (typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const s = stripNulls(v);
    if (s !== undefined) output[k] = s;
  }
  return output;
}

function sanitizeInvoiceListResponse(value: unknown): InvoiceListResponse {
  const data = stripNulls(value) as Partial<InvoiceListResponse>;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    page: safeNum(data.page, 1), limit: safeNum(data.limit, 0), total: safeNum(data.total, 0),
    totalAll: safeNum(data.totalAll!, undefined!), approvedAll: safeNum(data.approvedAll!, undefined!),
    pendingAll: safeNum(data.pendingAll!, undefined!)
  };
}

function sanitizeIngestionStatus(value: unknown): IngestionJobStatus {
  const data = stripNulls(value) as Partial<IngestionJobStatus>;
  const validStates = ["running", "completed", "failed", "idle", "paused"] as const;
  return {
    state: validStates.includes(data.state as typeof validStates[number]) ? data.state! : "idle",
    running: data.running === true,
    totalFiles: safeNum(data.totalFiles, 0), processedFiles: safeNum(data.processedFiles, 0),
    newInvoices: safeNum(data.newInvoices, 0), duplicates: safeNum(data.duplicates, 0),
    failures: safeNum(data.failures, 0),
    startedAt: safeStr(data.startedAt), completedAt: safeStr(data.completedAt),
    error: safeStr(data.error), correlationId: safeStr(data.correlationId),
    lastUpdatedAt: safeStr(data.lastUpdatedAt) ?? new Date(0).toISOString()
  };
}

function sanitizeGmailConnectionStatus(value: unknown): GmailConnectionStatus {
  const data = stripNulls(value) as Partial<GmailConnectionStatus>;
  const validStates = ["CONNECTED", "NEEDS_REAUTH", "DISCONNECTED"] as const;
  return {
    provider: "gmail",
    connectionState: validStates.includes(data.connectionState as typeof validStates[number]) ? data.connectionState! : "DISCONNECTED",
    emailAddress: safeStr(data.emailAddress), lastErrorReason: safeStr(data.lastErrorReason),
    lastSyncedAt: safeStr(data.lastSyncedAt)
  };
}

export function subscribeIngestionSSE(
  onMessage: (status: IngestionJobStatus) => void,
  onError?: () => void
): () => void {
  const base = apiClient.defaults.baseURL ?? "";
  const url = `${base}/jobs/ingest/sse`;
  const resolved = new URL(url, window.location.origin);
  const token = getStoredSessionToken();
  if (token) {
    resolved.searchParams.set("authToken", token);
  }
  const source = new EventSource(resolved.toString());
  source.onmessage = (e) => {
    onMessage(sanitizeIngestionStatus(JSON.parse(e.data)));
  };
  source.onerror = () => {
    onError?.();
    source.close();
  };
  return () => source.close();
}

function appendAuthTokenQuery(url: string): string {
  const token = getStoredSessionToken();
  if (!token) {
    return url;
  }

  const resolved = new URL(url, window.location.origin);
  resolved.searchParams.set("authToken", token);
  return resolved.toString();
}
