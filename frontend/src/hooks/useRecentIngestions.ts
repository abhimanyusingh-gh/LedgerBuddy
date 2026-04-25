import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchMailboxRecentIngestions,
  type MailboxRecentIngestionsResponse
} from "@/api/mailboxAssignments";

export const RECENT_INGESTIONS_QUERY_KEY = "mailboxRecentIngestions" as const;

export function recentIngestionsQueryKey(
  assignmentId: string,
  days: number,
  limit?: number
): readonly unknown[] {
  return [RECENT_INGESTIONS_QUERY_KEY, assignmentId, days, limit ?? null] as const;
}

export interface UseRecentIngestionsOptions {
  assignmentId: string;
  days: number;
  limit?: number;
  enabled?: boolean;
}

export function useRecentIngestions({
  assignmentId,
  days,
  limit,
  enabled = true
}: UseRecentIngestionsOptions): UseQueryResult<MailboxRecentIngestionsResponse, Error> {
  return useQuery<MailboxRecentIngestionsResponse, Error>({
    queryKey: recentIngestionsQueryKey(assignmentId, days, limit),
    queryFn: () => fetchMailboxRecentIngestions(assignmentId, { days, limit }),
    enabled: enabled && assignmentId.length > 0,
    staleTime: 30_000
  });
}

export interface UseRecentIngestionCountsArgs {
  assignmentIds: string[];
  days: number;
}

export interface RecentIngestionCountsResult {
  countsById: Record<string, number | undefined>;
  isLoading: boolean;
}

export function useRecentIngestionCounts({
  assignmentIds,
  days
}: UseRecentIngestionCountsArgs): RecentIngestionCountsResult {
  const queries = useQueries({
    queries: assignmentIds.map((id) => ({
      queryKey: recentIngestionsQueryKey(id, days, 1),
      queryFn: () => fetchMailboxRecentIngestions(id, { days, limit: 1 }),
      enabled: id.length > 0,
      staleTime: 30_000
    }))
  });

  const countsById: Record<string, number | undefined> = {};
  let isLoading = false;
  assignmentIds.forEach((id, index) => {
    const q = queries[index];
    if (q?.data) {
      countsById[id] = q.data.total;
    } else if (q?.isPending) {
      isLoading = true;
    }
  });

  return { countsById, isLoading };
}
