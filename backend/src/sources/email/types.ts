import type { WorkloadTier } from "@/types/tenant.js";
import type { GmailMailboxBoundary } from "@/core/boundaries/GmailMailboxBoundary.js";

interface PasswordEmailAuthConfig {
  type: "password";
  password: string;
}

export interface OAuth2EmailAuthConfig {
  type: "oauth2";
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  timeoutMs: number;
}

export type EmailAuthConfig = PasswordEmailAuthConfig | OAuth2EmailAuthConfig;

export interface EmailSourceConfig {
  key: string;
  tenantId?: string;
  workloadTier?: WorkloadTier;
  oauthUserId: string;
  transport: "imap" | "mailhog_oauth";
  mailhogApiBaseUrl: string;
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpTimeoutMs: number;
  username: string;
  mailbox: string;
  fromFilter?: string;
  auth: EmailAuthConfig;
  gmailMailboxBoundary?: GmailMailboxBoundary;
}
