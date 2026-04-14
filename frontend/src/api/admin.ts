import { apiClient, safeNum, stripNulls } from "@/api/client";
import type {
  AnalyticsOverview,
  ApprovalWorkflowConfig,
  GlCode,
  GmailConnectionStatus,
  RiskSignalDefinition,
  TallyFileExportResponse,
  TdsRate,
  TdsRateEntry,
  TenantComplianceConfig
} from "@/types";

export interface PlatformTenantUsageSummary {
  tenantId: string;
  tenantName: string;
  enabled: boolean;
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

export async function fetchAnalyticsOverview(from: string, to: string, scope: "mine" | "all" = "mine"): Promise<AnalyticsOverview> {
  return (await apiClient.get<AnalyticsOverview>("/analytics/overview", { params: { from, to, scope } })).data;
}

export async function fetchPlatformTenantUsage(): Promise<PlatformTenantUsageSummary[]> {
  const response = await apiClient.get<{ items?: PlatformTenantUsageSummary[] }>("/platform/tenants/usage");
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function setTenantEnabled(tenantId: string, enabled: boolean): Promise<void> {
  await apiClient.patch(`/platform/tenants/${tenantId}/enabled`, { enabled });
}

export async function onboardTenantAdmin(payload: {
  tenantName: string;
  adminEmail: string;
  adminDisplayName?: string;
  mode?: string;
}): Promise<PlatformTenantOnboardResult> {
  return (await apiClient.post<PlatformTenantOnboardResult>("/platform/tenants/onboard-admin", payload)).data;
}

export async function fetchApprovalWorkflow(): Promise<ApprovalWorkflowConfig> {
  return (await apiClient.get("/admin/approval-workflow")).data;
}

export async function saveApprovalWorkflow(config: ApprovalWorkflowConfig): Promise<ApprovalWorkflowConfig> {
  return (await apiClient.put("/admin/approval-workflow", config)).data;
}

export async function fetchGlCodes(params?: { search?: string; category?: string; active?: boolean }): Promise<{ items: GlCode[]; total: number }> {
  return (await apiClient.get<{ items: GlCode[]; total: number }>("/admin/gl-codes", { params: { limit: 200, ...params } })).data;
}

export async function createGlCode(payload: { code: string; name: string; category: string; linkedTdsSection?: string }): Promise<GlCode> {
  return (await apiClient.post<GlCode>("/admin/gl-codes", payload)).data;
}

async function updateGlCode(code: string, payload: Partial<{ name: string; category: string; linkedTdsSection: string | null; isActive: boolean }>): Promise<GlCode> {
  return (await apiClient.put<GlCode>(`/admin/gl-codes/${encodeURIComponent(code)}`, payload)).data;
}

export async function deleteGlCode(code: string): Promise<GlCode> {
  return (await apiClient.delete<GlCode>(`/admin/gl-codes/${encodeURIComponent(code)}`)).data;
}

export async function fetchTdsRates(): Promise<TdsRate[]> {
  return (await apiClient.get<{ items: TdsRate[] }>("/compliance/tds-rates")).data.items;
}

export async function fetchComplianceConfig(): Promise<TenantComplianceConfig> {
  return (await apiClient.get<TenantComplianceConfig>("/admin/compliance-config")).data;
}

export async function saveComplianceConfig(config: Partial<TenantComplianceConfig>): Promise<TenantComplianceConfig> {
  return (await apiClient.put<TenantComplianceConfig>("/admin/compliance-config", config)).data;
}

export async function fetchDefaultTdsSections(): Promise<TdsRateEntry[]> {
  return (await apiClient.get<{ items: TdsRateEntry[] }>("/compliance/tds-sections")).data.items;
}

export async function fetchAvailableRiskSignals(): Promise<RiskSignalDefinition[]> {
  return (await apiClient.get<{ items: RiskSignalDefinition[] }>("/compliance/risk-signals")).data.items;
}

export interface GlCodeImportResult {
  imported: number;
  skipped: number;
  errors: Array<{ row: number; message: string }>;
}

export async function importGlCodesCsv(file: File): Promise<GlCodeImportResult> {
  const formData = new FormData();
  formData.append("file", file);
  return (await apiClient.post<GlCodeImportResult>("/admin/gl-codes/import-csv", formData, {
    headers: { "Content-Type": "multipart/form-data" }
  })).data;
}

export async function fetchGmailConnectionStatus() {
  const data = stripNulls((await apiClient.get<GmailConnectionStatus>("/integrations/gmail")).data) as Partial<GmailConnectionStatus>;
  const validStates = ["CONNECTED", "NEEDS_REAUTH", "DISCONNECTED"] as const;
  return {
    provider: "gmail" as const,
    connectionState: validStates.includes(data.connectionState as typeof validStates[number]) ? data.connectionState! : "DISCONNECTED" as const,
    emailAddress: typeof data.emailAddress === "string" ? data.emailAddress : undefined,
    lastErrorReason: typeof data.lastErrorReason === "string" ? data.lastErrorReason : undefined,
    lastSyncedAt: typeof data.lastSyncedAt === "string" ? data.lastSyncedAt : undefined
  };
}

export async function fetchGmailConnectUrl(): Promise<string> {
  const response = await apiClient.get<{ connectUrl: string }>("/integrations/gmail/connect-url");
  const connectUrl = typeof response.data?.connectUrl === "string" ? response.data.connectUrl.trim() : "";
  if (!connectUrl) throw new Error("Gmail connect URL was not returned.");
  return connectUrl;
}
