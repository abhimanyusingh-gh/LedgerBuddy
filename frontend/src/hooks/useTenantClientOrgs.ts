import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

export const TENANT_CLIENT_ORGS_QUERY_KEY = ["tenantClientOrgs"] as const;

interface ClientOrgListResponseItem {
  id: string;
  companyName: string;
}

interface ClientOrgListResponse {
  items?: ClientOrgListResponseItem[];
}

export interface UseTenantClientOrgsResult {
  clientOrgs: ClientOrgOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

async function fetchTenantClientOrgs(): Promise<ClientOrgOption[]> {
  const response = await apiClient.get<ClientOrgListResponse>("/admin/client-orgs");
  const items = Array.isArray(response.data?.items) ? response.data.items : [];
  return items.map((item) => ({ id: item.id, companyName: item.companyName }));
}

export function useTenantClientOrgs(options?: { enabled?: boolean }): UseTenantClientOrgsResult {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: TENANT_CLIENT_ORGS_QUERY_KEY,
    queryFn: fetchTenantClientOrgs,
    enabled,
    staleTime: 60_000
  });
  return {
    clientOrgs: query.data,
    isLoading: query.isPending && enabled,
    isError: query.isError,
    refetch: query.refetch
  };
}
