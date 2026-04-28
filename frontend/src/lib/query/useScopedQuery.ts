import {
  useQuery,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult
} from "@tanstack/react-query";
import { useActiveClientOrg } from "@/hooks/useActiveClientOrg";

const SCOPED_QUERY_NAMESPACE = "clientOrg" as const;

type ScopedQueryKey = readonly unknown[];

interface ScopedQueryContext {
  activeClientOrgId: string;
}

interface UseScopedQueryOptions<TData, TError>
  extends Omit<UseQueryOptions<TData, TError, TData, QueryKey>, "queryKey" | "queryFn" | "enabled"> {
  queryKey: ScopedQueryKey;
  queryFn: (ctx: ScopedQueryContext) => Promise<TData>;
  enabled?: boolean;
}

export function useScopedQuery<TData, TError = Error>(
  options: UseScopedQueryOptions<TData, TError>
): UseQueryResult<TData, TError> {
  const { activeClientOrgId } = useActiveClientOrg();
  const { queryKey, queryFn, enabled = true, gcTime, ...rest } = options;
  const isInactive = activeClientOrgId === null;
  return useQuery<TData, TError, TData, QueryKey>({
    ...rest,
    gcTime: isInactive ? 0 : gcTime,
    queryKey: [SCOPED_QUERY_NAMESPACE, activeClientOrgId, ...queryKey],
    queryFn: () => {
      if (activeClientOrgId === null) {
        return Promise.reject(new Error("No active clientOrgId — useScopedQuery should be disabled"));
      }
      return queryFn({ activeClientOrgId });
    },
    enabled: enabled && !isInactive
  });
}
