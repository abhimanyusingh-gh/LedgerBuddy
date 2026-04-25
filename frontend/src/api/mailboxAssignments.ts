import { apiClient } from "@/api/client";

export const MAILBOX_ASSIGNMENT_STATUS = {
  Connected: "connected",
  RequiresReauth: "requires_reauth",
  Disconnected: "disconnected"
} as const;

export type MailboxAssignmentStatus =
  (typeof MAILBOX_ASSIGNMENT_STATUS)[keyof typeof MAILBOX_ASSIGNMENT_STATUS];

export interface MailboxAssignmentPollingConfig {
  enabled: boolean;
  intervalHours: number;
  lastPolledAt: string | null;
  nextPollAfter: string | null;
}

export interface MailboxAssignment {
  _id: string;
  integrationId: string;
  email: string | null;
  clientOrgIds: string[];
  assignedTo: string;
  status: string | null;
  lastSyncedAt: string | null;
  pollingConfig: MailboxAssignmentPollingConfig | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CreateMailboxAssignmentPayload {
  integrationId: string;
  clientOrgIds: string[];
  assignedTo?: string;
}

export interface UpdateMailboxAssignmentPayload {
  clientOrgIds?: string[];
  assignedTo?: string;
}

const MAILBOX_ASSIGNMENTS_PATH = "/admin/mailbox-assignments";

export async function fetchMailboxAssignments(): Promise<MailboxAssignment[]> {
  const response = await apiClient.get<{ items?: MailboxAssignment[] }>(MAILBOX_ASSIGNMENTS_PATH);
  return Array.isArray(response.data?.items) ? response.data.items : [];
}

export async function createMailboxAssignment(
  payload: CreateMailboxAssignmentPayload
): Promise<MailboxAssignment> {
  return (await apiClient.post<MailboxAssignment>(MAILBOX_ASSIGNMENTS_PATH, payload)).data;
}

export async function updateMailboxAssignment(
  id: string,
  payload: UpdateMailboxAssignmentPayload
): Promise<MailboxAssignment> {
  return (
    await apiClient.patch<MailboxAssignment>(
      `${MAILBOX_ASSIGNMENTS_PATH}/${encodeURIComponent(id)}`,
      payload
    )
  ).data;
}

export async function deleteMailboxAssignment(id: string): Promise<void> {
  await apiClient.delete(`${MAILBOX_ASSIGNMENTS_PATH}/${encodeURIComponent(id)}`);
}
