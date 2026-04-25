import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchClientOrganizations, type ClientOrganization } from "@/api/clientOrgs";
import type { ClientOrgOption } from "@/components/workspace/HierarchyBadges";

export const TENANT_CLIENT_ORGS_QUERY_KEY = ["tenantClientOrgs"] as const;

export interface UseTenantClientOrgsResult {
  clientOrgs: ClientOrgOption[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

function toOption(org: ClientOrganization): ClientOrgOption {
  return { id: org._id, companyName: org.companyName };
}

export function useTenantClientOrgs(options?: { enabled?: boolean }): UseTenantClientOrgsResult {
  const enabled = options?.enabled ?? true;
  const query = useQuery({
    queryKey: TENANT_CLIENT_ORGS_QUERY_KEY,
    queryFn: fetchClientOrganizations,
    enabled,
    staleTime: 0,
    select: (data) => data.map(toOption)
  });
  return {
    clientOrgs: query.data,
    isLoading: query.isPending && enabled,
    isError: query.isError,
    refetch: query.refetch
  };
}

export function useClientOrgsAdminList(): UseQueryResult<ClientOrganization[], Error> {
  return useQuery<ClientOrganization[], Error>({
    queryKey: TENANT_CLIENT_ORGS_QUERY_KEY,
    queryFn: fetchClientOrganizations,
    staleTime: 0
  });
}
