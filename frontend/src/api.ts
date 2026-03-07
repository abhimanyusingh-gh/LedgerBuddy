import axios from "axios";
import type {
  GmailConnectionStatus,
  IngestionJobStatus,
  Invoice,
  InvoiceListResponse,
  TallyExportResponse,
  TallyFileExportResponse
} from "./types";
import { normalizeApiError } from "./apiError";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api";
const backendBaseUrl = apiBaseUrl.replace(/\/api\/?$/, "");
const SESSION_TOKEN_KEY = "invoice_processor_session_token";

const apiClient = axios.create({ baseURL: apiBaseUrl });
const backendClient = axios.create({ baseURL: backendBaseUrl });

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

backendClient.interceptors.response.use(
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
}

interface PlatformTenantOnboardResult {
  tenantId: string;
  tenantName: string;
  adminUserId: string;
  adminEmail: string;
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
  const response = await backendClient.post<{ token?: string }>("/auth/token", {
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
}): Promise<PlatformTenantOnboardResult> {
  const response = await apiClient.post<PlatformTenantOnboardResult>("/platform/tenants/onboard-admin", payload);
  return response.data;
}

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

export async function runIngestion() {
  const response = await apiClient.post<IngestionJobStatus>("/jobs/ingest");
  return sanitizeIngestionStatus(response.data);
}

export async function runEmailSimulationIngestion() {
  const response = await apiClient.post<IngestionJobStatus>("/jobs/ingest/email-simulate");
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
    correlationId: typeof data.correlationId === "string" ? data.correlationId : undefined,
    lastUpdatedAt: typeof data.lastUpdatedAt === "string" ? data.lastUpdatedAt : new Date(0).toISOString()
  };
}

function sanitizeGmailConnectionStatus(value: unknown): GmailConnectionStatus {
  const data = stripNulls(value) as Partial<GmailConnectionStatus>;
  const connectionState =
    data.connectionState === "CONNECTED" || data.connectionState === "NEEDS_REAUTH" || data.connectionState === "DISCONNECTED"
      ? data.connectionState
      : "DISCONNECTED";

  return {
    provider: "gmail",
    connectionState,
    emailAddress: typeof data.emailAddress === "string" ? data.emailAddress : undefined,
    lastErrorReason: typeof data.lastErrorReason === "string" ? data.lastErrorReason : undefined,
    lastSyncedAt: typeof data.lastSyncedAt === "string" ? data.lastSyncedAt : undefined
  };
}

function appendAuthTokenQuery(url: string): string {
  const token = getStoredSessionToken();
  if (!token) {
    return url;
  }

  const resolved = new URL(url, backendBaseUrl);
  resolved.searchParams.set("authToken", token);
  return resolved.toString();
}
