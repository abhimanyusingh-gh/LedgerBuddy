import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  fetchMailboxRecentIngestions,
  type MailboxRecentIngestionsResponse
} from "@/api/mailboxAssignments";

const RECENT_INGESTIONS_QUERY_KEY = "mailboxRecentIngestions" as const;

export function recentIngestionsQueryKey(
  assignmentId: string,
  days: number,
  limit?: number
): readonly unknown[] {
  return [RECENT_INGESTIONS_QUERY_KEY, assignmentId, days, limit ?? null] as const;
}

interface UseRecentIngestionsOptions {
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

interface UseRecentIngestionCountsArgs {
  assignmentIds: string[];
  days: number;
}

interface RecentIngestionCountsResult {
  countsById: Record<string, number | null | undefined>;
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

  const countsById: Record<string, number | null | undefined> = {};
  assignmentIds.forEach((id, index) => {
    const q = queries[index];
    if (q?.data) {
      countsById[id] = q.data.total;
    } else if (q?.isError) {
      countsById[id] = null;
    }
  });

  return { countsById };
}
