import { apiClient } from "@/api/client";
import { complianceUrls } from "@/api/urls/complianceUrls";
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
  return (await apiClient.get<TcsConfig>(complianceUrls.tcsConfig())).data;
}

export async function updateTcsConfig(body: UpdateTcsConfigBody): Promise<TcsConfig> {
  return (await apiClient.put<TcsConfig>(complianceUrls.tcsConfig(), body)).data;
}

export async function updateTcsModifyRoles(roles: string[]): Promise<TcsConfig> {
  return (await apiClient.put<TcsConfig>(complianceUrls.tcsConfigRoles(), { tcsModifyRoles: roles })).data;
}

export async function fetchTcsHistory(page: number = 1): Promise<TcsHistoryResponse> {
  return (await apiClient.get<TcsHistoryResponse>(complianceUrls.tcsConfigHistory(), { params: { page } })).data;
}
