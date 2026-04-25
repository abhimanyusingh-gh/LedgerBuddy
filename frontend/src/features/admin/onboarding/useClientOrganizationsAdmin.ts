import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchClientOrganizations, type ClientOrganization } from "@/api/clientOrgs";

export const CLIENT_ORGS_ADMIN_QUERY_KEY = ["admin", "clientOrgs"] as const;

export function useClientOrganizationsAdmin(): UseQueryResult<ClientOrganization[], Error> {
  return useQuery<ClientOrganization[], Error>({
    queryKey: CLIENT_ORGS_ADMIN_QUERY_KEY,
    queryFn: fetchClientOrganizations
  });
}
