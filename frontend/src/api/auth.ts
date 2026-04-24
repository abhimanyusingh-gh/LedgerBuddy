import axios from "axios";
import { apiClient } from "@/api/client";
import type { SessionUser, TenantRole, TenantUser } from "@/types";

export type FeatureFlagName = "example.healthCheckVerbose";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4100/api";

export async function refreshSessionToken(currentToken: string): Promise<string> {
  const response = await axios.post<{ token: string }>(
    `${apiBaseUrl}/auth/refresh`,
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
  const response = await apiClient.post<{ token?: string }>("/auth/token", { email, password });
  const token = typeof response.data?.token === "string" ? response.data.token.trim() : "";
  if (!token) throw new Error("Login did not return a session token.");
  return token;
}

export async function fetchSessionContext(): Promise<SessionContextResponse> {
  return (await apiClient.get<SessionContextResponse>("/session")).data;
}

export async function completeTenantOnboarding(payload: { tenantName: string; adminEmail: string }): Promise<void> {
  await apiClient.post("/tenant/onboarding/complete", payload);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await apiClient.post("/auth/change-password", { currentPassword, newPassword });
}

export async function fetchTenantUsers(): Promise<TenantUser[]> {
  const response = await apiClient.get<{ items?: TenantUser[] }>("/admin/users");
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function inviteTenantUser(email: string): Promise<void> {
  await apiClient.post("/admin/users/invite", { email });
}

export async function assignTenantUserRole(userId: string, role: TenantRole): Promise<void> {
  await apiClient.post(`/admin/users/${userId}/role`, { role });
}

export async function removeTenantUser(userId: string): Promise<void> {
  await apiClient.delete(`/admin/users/${userId}`);
}

export async function setUserEnabled(userId: string, enabled: boolean): Promise<void> {
  await apiClient.patch(`/admin/users/${userId}/enabled`, { enabled });
}
