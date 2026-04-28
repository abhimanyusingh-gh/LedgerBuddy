import { apiClient } from "@/api/client";
import { platformUrls } from "@/api/urls/platformUrls";
import { tenantUrls } from "@/api/urls/tenantUrls";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { writeTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";
import type { SessionUser, TenantRole, TenantUser } from "@/types";

export type FeatureFlagName = "example.healthCheckVerbose";

export async function refreshSessionToken(currentToken: string): Promise<string> {
  const response = await apiClient.post<{ token: string }>(
    platformUrls.authRefresh(),
    {},
    { headers: { Authorization: `Bearer ${currentToken}` } }
  );
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) throw new Error("Refresh did not return a session token.");
  return token;
}

interface SessionContextResponse {
  user: SessionUser;
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
    must_change_password: boolean;
  };
  featureFlags: Record<FeatureFlagName, boolean>;
}

export async function loginWithCredentials(email: string, password: string): Promise<string> {
  const response = await apiClient.post<{ token?: string }>(platformUrls.authToken(), { email, password });
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) throw new Error("Login did not return a session token.");
  return token;
}

export async function fetchSessionContext(): Promise<SessionContextResponse> {
  const response = (await apiClient.get<SessionContextResponse>(platformUrls.session())).data;
  writeActiveTenantId(response.tenant?.id ?? null);
  writeTenantSetupCompleted(response.flags?.requires_tenant_setup === false);
  return response;
}

export async function completeTenantOnboarding(payload: { tenantName: string; adminEmail: string }): Promise<void> {
  await apiClient.post(tenantUrls.onboardingComplete(), payload);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post(platformUrls.authChangePassword(), { currentPassword, newPassword });
}

export async function fetchTenantUsers(): Promise<TenantUser[]> {
  const response = await apiClient.get<{ items?: TenantUser[] }>(tenantUrls.usersList());
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function inviteTenantUser(email: string): Promise<void> {
  await apiClient.post(tenantUrls.usersInvite(), { email });
}

export async function assignTenantUserRole(userId: string, role: TenantRole): Promise<void> {
  await apiClient.post(tenantUrls.userRole(userId), { role });
}

export async function removeTenantUser(userId: string): Promise<void> {
  await apiClient.delete(tenantUrls.userDelete(userId));
}

export async function setUserEnabled(userId: string, enabled: boolean): Promise<void> {
  await apiClient.patch(tenantUrls.userEnabled(userId), { enabled });
}
