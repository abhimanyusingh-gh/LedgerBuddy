import { apiClient } from "@/api/client";
import type { TcsConfig, TcsRateChange } from "@/types";

interface UpdateTcsConfigBody {
  ratePercent: number;
  effectiveFrom: string;
  enabled: boolean;
  reason?: string;
}

interface TcsHistoryResponse {
  items: TcsRateChange[];
  page: number;
  limit: number;
  total: number;
}

export async function fetchTcsConfig(): Promise<TcsConfig> {
  return (await apiClient.get<TcsConfig>("/admin/tcs-config")).data;
}

export async function updateTcsConfig(body: UpdateTcsConfigBody): Promise<TcsConfig> {
  return (await apiClient.put<TcsConfig>("/admin/tcs-config", body)).data;
}

export async function updateTcsModifyRoles(roles: string[]): Promise<TcsConfig> {
  return (await apiClient.put<TcsConfig>("/admin/tcs-config/roles", { tcsModifyRoles: roles })).data;
}

export async function fetchTcsHistory(page: number = 1): Promise<TcsHistoryResponse> {
  return (await apiClient.get<TcsHistoryResponse>("/admin/tcs-config/history", { params: { page } })).data;
}
