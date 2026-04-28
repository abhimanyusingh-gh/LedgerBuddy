import { apiClient, safeNum, stripNulls } from "@/api/client";
import { analyticsUrls } from "@/api/urls/analyticsUrls";
import { complianceUrls } from "@/api/urls/complianceUrls";
import { mailboxUrls } from "@/api/urls/mailboxUrls";
import type {
  AnalyticsOverview,
  ApprovalWorkflowConfig,
  GlCode,
  GmailConnectionStatus,
  RiskSignalDefinition,
  TdsRate,
  TdsRateEntry,
  ClientComplianceConfig
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

export async function fetchAnalyticsOverview(
  from: string,
  to: string,
  scope: "mine" | "all" = "mine",
  clientOrgId?: string | null
): Promise<AnalyticsOverview> {
  const params: Record<string, string> = { from, to, scope };
  if (clientOrgId) params.clientOrgId = clientOrgId;
  return (await apiClient.get<AnalyticsOverview>(analyticsUrls.overview(), { params })).data;
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
  return (await apiClient.get(complianceUrls.approvalWorkflow())).data;
}

export async function saveApprovalWorkflow(config: ApprovalWorkflowConfig): Promise<ApprovalWorkflowConfig> {
  return (await apiClient.put(complianceUrls.approvalWorkflow(), config)).data;
}

export async function fetchGlCodes(params?: { search?: string; category?: string; active?: boolean }): Promise<{ items: GlCode[]; total: number }> {
  return (await apiClient.get<{ items: GlCode[]; total: number }>(complianceUrls.glCodesList(), { params: { limit: 200, ...params } })).data;
}

export async function createGlCode(payload: { code: string; name: string; category: string; linkedTdsSection?: string }): Promise<GlCode> {
  return (await apiClient.post<GlCode>(complianceUrls.glCodesCreate(), payload)).data;
}

async function updateGlCode(code: string, payload: Partial<{ name: string; category: string; linkedTdsSection: string | null; isActive: boolean }>): Promise<GlCode> {
  return (await apiClient.put<GlCode>(complianceUrls.glCodeUpdate(code), payload)).data;
}

export async function deleteGlCode(code: string): Promise<GlCode> {
  return (await apiClient.delete<GlCode>(complianceUrls.glCodeDelete(code))).data;
}

export async function fetchTdsRates(): Promise<TdsRate[]> {
  return (await apiClient.get<{ items: TdsRate[] }>("/compliance/tds-rates")).data.items;
}

export async function fetchComplianceConfig(): Promise<ClientComplianceConfig> {
  return (await apiClient.get<ClientComplianceConfig>(complianceUrls.complianceConfig())).data;
}

export async function saveComplianceConfig(config: Partial<ClientComplianceConfig>): Promise<ClientComplianceConfig> {
  return (await apiClient.put<ClientComplianceConfig>(complianceUrls.complianceConfig(), config)).data;
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
  return (await apiClient.post<GlCodeImportResult>(complianceUrls.glCodesImportCsv(), formData, {
    headers: { "Content-Type": "multipart/form-data" }
  })).data;
}

interface ApprovalLimitEntry {
  approvalLimitMinor: number | null;
  userIds: string[];
}

interface ApprovalLimitsResponse {
  limits: Record<string, ApprovalLimitEntry>;
  complianceSignoffUsers: Array<{ userId: string; role: string }>;
}

export async function fetchApprovalLimits(): Promise<ApprovalLimitsResponse> {
  return (await apiClient.get<ApprovalLimitsResponse>(complianceUrls.approvalLimits())).data;
}

export async function saveApprovalLimits(limits: Record<string, number | null>): Promise<{ updated: boolean }> {
  return (await apiClient.put<{ updated: boolean }>(complianceUrls.approvalLimits(), { limits })).data;
}

export interface NotificationConfig {
  mailboxReauthEnabled: boolean;
  escalationEnabled: boolean;
  inAppEnabled: boolean;
  primaryRecipientType: "integration_creator" | "all_tenant_admins" | "specific_user";
  specificRecipientUserId: string | null;
}

export interface NotificationLogEvent {
  _id: string;
  userId: string;
  provider: string;
  emailAddress: string;
  eventType: string;
  reason: string;
  delivered: boolean;
  deliveryFailed: boolean;
  failureReason: string | null;
  skippedReason: string | null;
  recipient: string | null;
  retryCount: number;
  createdAt: string;
}

export interface NotificationLogResponse {
  items: NotificationLogEvent[];
  page: number;
  limit: number;
  total: number;
}

export async function fetchNotificationConfig(): Promise<NotificationConfig> {
  return (await apiClient.get<NotificationConfig>(complianceUrls.notificationConfig())).data;
}

export async function saveNotificationConfig(config: Partial<NotificationConfig>): Promise<NotificationConfig> {
  return (await apiClient.patch<NotificationConfig>(complianceUrls.notificationConfig(), config)).data;
}

export async function fetchNotificationLog(page = 1, limit = 20): Promise<NotificationLogResponse> {
  return (await apiClient.get<NotificationLogResponse>(mailboxUrls.notificationLog(), { params: { page, limit } })).data;
}

export async function fetchGmailConnectionStatus() {
  const data = stripNulls((await apiClient.get<GmailConnectionStatus>(mailboxUrls.gmailStatus())).data) as Partial<GmailConnectionStatus>;
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
  const response = await apiClient.get<{ connectUrl: string }>(mailboxUrls.gmailConnectUrl());
  const connectUrl = typeof response.data?.connectUrl === "string" ? response.data.connectUrl.trim() : "";
  if (!connectUrl) throw new Error("Gmail connect URL was not returned.");
  return connectUrl;
}
