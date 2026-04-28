import { useQuery } from "@tanstack/react-query";
import {
  fetchTriageInvoices,
  TRIAGE_QUEUE_QUERY_KEY,
  type TriageInvoice
} from "@/api/triage";
import { useTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";

interface UseTriageQueueResult {
  invoices: TriageInvoice[];
  total: number;
  isLoading: boolean;
  isError: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

export function useTriageQueue(): UseTriageQueueResult {
  const tenantSetupCompleted = useTenantSetupCompleted();
  const query = useQuery({
    queryKey: TRIAGE_QUEUE_QUERY_KEY,
    queryFn: fetchTriageInvoices,
    staleTime: 0,
    enabled: tenantSetupCompleted
  });
  return {
    invoices: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isPending && tenantSetupCompleted,
    isError: query.isError,
    isRefetching: query.isRefetching,
    refetch: query.refetch
  };
}
