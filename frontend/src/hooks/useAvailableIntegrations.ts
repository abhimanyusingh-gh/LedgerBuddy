import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { listIntegrations, type AvailableIntegration } from "@/api/mailboxAssignments";

const AVAILABLE_INTEGRATIONS_QUERY_KEY = ["availableIntegrations"] as const;

export function useAvailableIntegrations(
  enabled: boolean
): UseQueryResult<AvailableIntegration[], Error> {
  return useQuery<AvailableIntegration[], Error>({
    queryKey: AVAILABLE_INTEGRATIONS_QUERY_KEY,
    queryFn: listIntegrations,
    enabled,
    staleTime: 0
  });
}
