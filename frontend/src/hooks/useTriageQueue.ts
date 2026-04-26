import { useQuery } from "@tanstack/react-query";
import {
  fetchTriageInvoices,
  TRIAGE_QUEUE_QUERY_KEY,
  type TriageInvoice
} from "@/api/triage";
import { useTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";

// The triage queue is the ONE accounting-leaf list that legitimately filters by
// `tenantId` WITHOUT `clientOrgId` — these invoices have `clientOrgId: null`
// because the mailbox couldn't decide which realm they belong to. Documented
// exception per #156. We deliberately use plain `useQuery` (NOT `useScopedQuery`)
// so the request fires regardless of which (if any) realm is active.
//
// Gated on `tenantSetupCompleted` (#193): the BE route is mounted behind
// `requireTenantSetupCompleted`, so firing this for a mid-setup tenant just
// produces 403 noise. When setup is not complete the hook reports its empty
// no-data state.
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
