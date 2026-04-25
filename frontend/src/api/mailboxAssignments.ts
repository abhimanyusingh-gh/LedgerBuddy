import { apiClient } from "@/api/client";

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

interface CreateMailboxAssignmentPayload {
  integrationId: string;
  clientOrgIds: string[];
  assignedTo?: string;
}

interface UpdateMailboxAssignmentPayload {
  clientOrgIds?: string[];
  assignedTo?: string;
}

const MAILBOX_ASSIGNMENTS_PATH = "/admin/mailbox-assignments";

export interface MailboxRecentIngestionItem {
  _id: string;
  clientOrgId: string | null;
  status: string | null;
  attachmentName: string | null;
  receivedAt: string | null;
  createdAt: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  totalAmountMinor: number | null;
  currency: string | null;
}

export interface MailboxRecentIngestionsResponse {
  items: MailboxRecentIngestionItem[];
  total: number;
  periodDays: number;
  truncatedAt: number;
}

export async function fetchMailboxRecentIngestions(
  id: string,
  params: { days: number; limit?: number }
): Promise<MailboxRecentIngestionsResponse> {
  const response = await apiClient.get<MailboxRecentIngestionsResponse>(
    `${MAILBOX_ASSIGNMENTS_PATH}/${encodeURIComponent(id)}/recent-ingestions`,
    { params: { days: params.days, ...(params.limit !== undefined ? { limit: params.limit } : {}) } }
  );
  return response.data;
}

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
