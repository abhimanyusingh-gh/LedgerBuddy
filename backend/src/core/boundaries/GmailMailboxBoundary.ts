export interface GmailIngestionCredentials {
  emailAddress: string;
  accessToken: string;
}

export interface GmailMailboxBoundary {
  resolveIngestionCredentials(userId: string): Promise<GmailIngestionCredentials | null>;
  markSyncSuccess(userId: string): Promise<void>;
}
