import { EmailIngestionFacade } from "./facades/EmailIngestionFacade.js";
import type { IngestionSource } from "./interfaces/IngestionSource.js";
import type { IngestionSourceManifest } from "./runtimeManifest.js";
import { FolderIngestionSource } from "../sources/FolderIngestionSource.js";
import type { GmailMailboxBoundary } from "./boundaries/GmailMailboxBoundary.js";

interface SourceRegistryOptions {
  gmailMailboxBoundary?: GmailMailboxBoundary;
}

export function buildIngestionSources(
  sourceManifests: IngestionSourceManifest[],
  options: SourceRegistryOptions = {}
): IngestionSource[] {
  const sources: IngestionSource[] = [];

  for (const sourceManifest of sourceManifests) {
    if (sourceManifest.type === "email") {
      assertEmailSourceConfiguration(sourceManifest);
      sources.push(
        new EmailIngestionFacade({
          key: sourceManifest.key,
          tenantId: sourceManifest.tenantId,
          workloadTier: sourceManifest.workloadTier,
          oauthUserId: sourceManifest.oauthUserId,
          transport: sourceManifest.transport,
          mailhogApiBaseUrl: sourceManifest.mailhogApiBaseUrl,
          host: sourceManifest.host,
          port: sourceManifest.port,
          secure: sourceManifest.secure,
          smtpHost: sourceManifest.smtpHost,
          smtpPort: sourceManifest.smtpPort,
          smtpSecure: sourceManifest.smtpSecure,
          smtpTimeoutMs: sourceManifest.smtpTimeoutMs,
          username: sourceManifest.username,
          auth:
            sourceManifest.authMode === "oauth2"
              ? {
                  type: "oauth2",
                  clientId: sourceManifest.oauth2.clientId,
                  clientSecret: sourceManifest.oauth2.clientSecret,
                  refreshToken: sourceManifest.oauth2.refreshToken,
                  accessToken: sourceManifest.oauth2.accessToken,
                  tokenUrl: sourceManifest.oauth2.tokenEndpoint,
                  timeoutMs: 15_000
                }
              : {
                  type: "password",
                  password: sourceManifest.password
                },
          mailbox: sourceManifest.mailbox,
          fromFilter: sourceManifest.fromFilter,
          gmailMailboxBoundary: options.gmailMailboxBoundary
        })
      );
      continue;
    }

    if (sourceManifest.type === "folder") {
      if (!sourceManifest.folderPath) {
        throw new Error("Folder source selected but FOLDER_SOURCE_PATH is missing.");
      }

      sources.push(
        new FolderIngestionSource({
          key: sourceManifest.key,
          tenantId: sourceManifest.tenantId,
          workloadTier: sourceManifest.workloadTier,
          folderPath: sourceManifest.folderPath,
          recursive: sourceManifest.recursive
        })
      );
      continue;
    }

    throw new Error("Unsupported ingestion source. Add an IngestionSource implementation to support it.");
  }

  return sources;
}

function assertEmailSourceConfiguration(sourceManifest: Extract<IngestionSourceManifest, { type: "email" }>): void {
  if (!sourceManifest.username) {
    throw new Error("Email source selected but EMAIL_USERNAME is missing.");
  }

  if (sourceManifest.transport === "imap" && !sourceManifest.host) {
    throw new Error("Email IMAP source selected but EMAIL_HOST is missing.");
  }

  if (sourceManifest.transport === "mailhog_oauth" && !sourceManifest.mailhogApiBaseUrl.trim()) {
    throw new Error("MailHog OAuth source selected but EMAIL_MAILHOG_API_BASE_URL is missing.");
  }

  if (sourceManifest.transport === "mailhog_oauth" && sourceManifest.authMode !== "oauth2") {
    throw new Error("MailHog OAuth source requires EMAIL_AUTH_MODE=oauth2.");
  }

  if (sourceManifest.authMode === "oauth2") {
    const hasStaticAccessToken = sourceManifest.oauth2.accessToken.trim().length > 0;
    const hasRefreshTokenBundle =
      sourceManifest.oauth2.clientId.trim().length > 0 &&
      sourceManifest.oauth2.clientSecret.trim().length > 0 &&
      sourceManifest.oauth2.refreshToken.trim().length > 0 &&
      sourceManifest.oauth2.tokenEndpoint.trim().length > 0;

    if (!hasStaticAccessToken && !hasRefreshTokenBundle && sourceManifest.oauthUserId.trim().length === 0) {
      throw new Error(
        "Email source OAuth2 selected but credentials are incomplete. Provide access token or client_id/client_secret/refresh_token/token_endpoint."
      );
    }
    return;
  }

  if (!sourceManifest.password) {
    throw new Error("Email source password auth selected but EMAIL_PASSWORD is missing.");
  }
}
