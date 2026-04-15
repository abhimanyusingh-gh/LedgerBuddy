export const GMAIL_CONNECTION_STATUS = {
  CONNECTED: "connected",
  REQUIRES_REAUTH: "requires_reauth",
  ERROR: "error",
} as const;

export type GmailConnectionStatus = (typeof GMAIL_CONNECTION_STATUS)[keyof typeof GMAIL_CONNECTION_STATUS];
