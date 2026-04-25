import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { fetchMailboxAssignments, type MailboxAssignment } from "@/api/mailboxAssignments";

export const MAILBOX_ASSIGNMENTS_QUERY_KEY = ["mailboxAssignments"] as const;

export function useMailboxAssignments(): UseQueryResult<MailboxAssignment[], Error> {
  return useQuery<MailboxAssignment[], Error>({
    queryKey: MAILBOX_ASSIGNMENTS_QUERY_KEY,
    queryFn: fetchMailboxAssignments,
    staleTime: 0
  });
}
