import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailIngestionBoundary } from "../../core/boundaries/EmailIngestionBoundary.js";
import type { IngestedFile } from "../../core/interfaces/IngestionSource.js";
import { logger } from "../../utils/logger.js";
import { isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "../../utils/mime.js";
import { refreshGoogleAccessToken } from "./gmailOAuthClient.js";
import type { EmailSourceConfig, OAuth2EmailAuthConfig } from "./types.js";
import { verifySmtpXoauth2 } from "./smtpXoauth2Probe.js";
import { GmailMailboxNeedsReauthError } from "./errors.js";

interface ResolvedImapAuth {
  auth: {
    user: string;
    pass?: string;
    accessToken?: string;
  };
  smtpProbe?: {
    user: string;
    accessToken: string;
  };
  linkedUserId?: string;
}

export class GmailImapIngestionProvider implements EmailIngestionBoundary {
  private accessTokenCache: { value: string; expiresAtMs: number } | null = null;

  constructor(private readonly config: EmailSourceConfig) {}

  async fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    try {
      return await this.fetchWithAuth(lastCheckpoint, false);
    } catch (error) {
      if (!this.shouldRetryWithFreshToken(error)) {
        throw error;
      }

      logger.warn("email.oauth.retrying_with_refreshed_token", {
        sourceKey: this.config.key,
        mailbox: this.config.mailbox,
        host: this.config.host
      });

      return this.fetchWithAuth(lastCheckpoint, true);
    }
  }

  private async fetchWithAuth(lastCheckpoint: string | null, forceTokenRefresh: boolean): Promise<IngestedFile[]> {
    const resolvedAuth = await this.resolveImapAuth(forceTokenRefresh);
    if (resolvedAuth.smtpProbe) {
      await verifySmtpXoauth2({
        host: this.config.smtpHost,
        port: this.config.smtpPort,
        secure: this.config.smtpSecure,
        user: resolvedAuth.smtpProbe.user,
        accessToken: resolvedAuth.smtpProbe.accessToken,
        timeoutMs: this.config.smtpTimeoutMs
      });
    }

    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: resolvedAuth.auth,
      tls: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true
      }
    });

    const files: IngestedFile[] = [];
    const minUid = lastCheckpoint ? Number(lastCheckpoint) : 0;

    await client.connect();

    try {
      await client.mailboxOpen(this.config.mailbox);

      for await (const message of client.fetch("1:*", {
        uid: true,
        source: true,
        envelope: true,
        internalDate: true
      })) {
        if (!message.uid || message.uid <= minUid || !message.source) {
          continue;
        }

        const parsedMail = await simpleParser(message.source);
        const from = parsedMail.from?.text ?? "";
        if (this.config.fromFilter && !from.toLowerCase().includes(this.config.fromFilter.toLowerCase())) {
          continue;
        }

        for (const attachment of parsedMail.attachments ?? []) {
          const mimeType = normalizeInvoiceMimeType(attachment.contentType ?? "");
          if (!isSupportedInvoiceMimeType(mimeType)) {
            continue;
          }

          files.push({
            tenantId: this.config.tenantId ?? "default",
            workloadTier: this.config.workloadTier ?? "standard",
            sourceKey: this.config.key,
            sourceType: "email",
            sourceDocumentId: String(message.uid),
            attachmentName: attachment.filename ?? `attachment-${message.uid}`,
            mimeType,
            receivedAt: normalizeReceivedAt(message.internalDate, parsedMail.date),
            buffer: attachment.content,
            checkpointValue: String(message.uid),
            metadata: {
              messageId: parsedMail.messageId ?? "",
              subject: parsedMail.subject ?? "",
              from
            }
          });
        }
      }
    } catch (error) {
      logger.error("email.source.fetch.failed", {
        sourceKey: this.config.key,
        mailbox: this.config.mailbox,
        host: this.config.host,
        authMode: this.config.auth.type,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await client.logout().catch(() => undefined);
    }

    if (resolvedAuth.linkedUserId && this.config.gmailMailboxBoundary) {
      await this.config.gmailMailboxBoundary.markSyncSuccess(resolvedAuth.linkedUserId);
    }

    files.sort((a, b) => Number(a.checkpointValue) - Number(b.checkpointValue));
    return files;
  }

  private async resolveImapAuth(forceTokenRefresh: boolean): Promise<ResolvedImapAuth> {
    if (this.config.auth.type === "password") {
      return {
        auth: {
          user: this.config.username,
          pass: this.config.auth.password
        }
      };
    }

    if (this.config.gmailMailboxBoundary) {
      const mailboxOwnerId = this.config.tenantId ?? this.config.oauthUserId;
      const linked = await this.config.gmailMailboxBoundary.resolveIngestionCredentials(mailboxOwnerId);
      if (linked) {
        return {
          auth: {
            user: linked.emailAddress,
            accessToken: linked.accessToken
          },
          smtpProbe: {
            user: linked.emailAddress,
            accessToken: linked.accessToken
          },
          linkedUserId: mailboxOwnerId
        };
      }
    }

    const fallbackToken = await this.resolveAccessToken(this.config.auth, forceTokenRefresh);
    return {
      auth: {
        user: this.config.username,
        accessToken: fallbackToken
      },
      smtpProbe: {
        user: this.config.username,
        accessToken: fallbackToken
      }
    };
  }

  private async resolveAccessToken(oauth: OAuth2EmailAuthConfig, forceRefresh: boolean): Promise<string> {
    const cached = this.accessTokenCache;
    if (!forceRefresh && cached && cached.expiresAtMs > Date.now() + 60_000) {
      return cached.value;
    }

    const staticToken = oauth.accessToken.trim();
    const hasRefreshConfig = Boolean(oauth.refreshToken.trim() && oauth.clientId.trim() && oauth.clientSecret.trim());

    if (!forceRefresh && staticToken) {
      return staticToken;
    }

    if (!hasRefreshConfig) {
      if (staticToken) {
        return staticToken;
      }
      throw new Error("OAuth2 authentication requires access token or refresh token credentials.");
    }

    const refreshed = await refreshGoogleAccessToken({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken: oauth.refreshToken,
      tokenEndpoint: oauth.tokenUrl,
      timeoutMs: oauth.timeoutMs
    });

    this.accessTokenCache = {
      value: refreshed.accessToken,
      expiresAtMs: Date.now() + refreshed.expiresInSeconds * 1000
    };

    return refreshed.accessToken;
  }

  private shouldRetryWithFreshToken(error: unknown): boolean {
    if (error instanceof GmailMailboxNeedsReauthError) {
      return false;
    }

    if (this.config.auth.type !== "oauth2") {
      return false;
    }

    const hasRefreshConfig = Boolean(
      this.config.auth.refreshToken.trim() && this.config.auth.clientId.trim() && this.config.auth.clientSecret.trim()
    );
    if (!hasRefreshConfig) {
      return false;
    }

    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("auth") || message.includes("invalid credentials") || message.includes("xoauth2");
  }
}

function normalizeReceivedAt(internalDate: unknown, parsedDate: Date | undefined): Date {
  if (internalDate instanceof Date) {
    return internalDate;
  }
  if (typeof internalDate === "string") {
    const parsed = new Date(internalDate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return parsedDate ?? new Date();
}
