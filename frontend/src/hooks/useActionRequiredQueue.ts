import { useMemo } from "react";
import { fetchInvoices } from "@/api";
import { useScopedQuery } from "@/lib/query/useScopedQuery";
import { useActiveClientOrg } from "@/hooks/useActiveClientOrg";
import { useTenantSetupCompleted } from "@/hooks/useTenantSetupCompleted";
import {
  buildActionQueue,
  totalActionCount,
  type ActionQueueGroup
} from "@/lib/invoice/actionRequired";

const ACTION_QUEUE_PAGE_SIZE = 500;
const ACTION_QUEUE_STALE_MS = 15_000;
export const ACTION_QUEUE_QUERY_KEY = ["invoices", "action-required"] as const;

interface UseActionRequiredQueueResult {
  groups: ActionQueueGroup[];
  totalCount: number | null;
  scannedCount: number;
  totalAvailable: number;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export function useActionRequiredQueue(): UseActionRequiredQueueResult {
  const { activeClientOrgId } = useActiveClientOrg();
  const tenantSetupCompleted = useTenantSetupCompleted();
  const isRealmActive = activeClientOrgId !== null;
  const isEnabled = isRealmActive && tenantSetupCompleted;
  const query = useScopedQuery({
    queryKey: ACTION_QUEUE_QUERY_KEY,
    queryFn: () => fetchInvoices({ page: 1, limit: ACTION_QUEUE_PAGE_SIZE }),
    staleTime: ACTION_QUEUE_STALE_MS,
    enabled: tenantSetupCompleted
  });

  const groups = useMemo(
    () => (query.data ? buildActionQueue(query.data.items) : []),
    [query.data]
  );

  return {
    groups,
    totalCount: isEnabled ? totalActionCount(groups) : null,
    scannedCount: query.data?.items.length ?? 0,
    totalAvailable: query.data?.total ?? 0,
    isLoading: query.isPending && isEnabled,
    isError: query.isError,
    refetch: query.refetch
  };
}
