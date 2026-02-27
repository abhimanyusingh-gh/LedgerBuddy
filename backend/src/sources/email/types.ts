import type { WorkloadTier } from "../../types/tenant.js";

export interface PasswordEmailAuthConfig {
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
  transport: "imap" | "mailhog_oauth";
  mailhogApiBaseUrl: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  fromFilter?: string;
  auth: EmailAuthConfig;
}
