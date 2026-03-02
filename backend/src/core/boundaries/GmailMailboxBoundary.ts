export interface GmailIngestionCredentials {
  emailAddress: string;
  accessToken: string;
}

export interface GmailMailboxBoundary {
  resolveIngestionCredentials(tenantId: string): Promise<GmailIngestionCredentials | null>;
  markSyncSuccess(tenantId: string): Promise<void>;
}
