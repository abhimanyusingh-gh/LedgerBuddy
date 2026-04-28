import axios from "axios";
import { simpleParser } from "mailparser";
import type { EmailIngestionBoundary } from "@/core/boundaries/EmailIngestionBoundary.js";
import type { IngestedFile } from "@/core/interfaces/IngestionSource.js";
import { logger } from "@/utils/logger.js";
import { isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "@/utils/mime.js";
import { assertDocumentMimeType } from "@/types/mime.js";
import { refreshGoogleAccessToken } from "@/sources/email/gmailOAuthClient.js";
import type { EmailSourceConfig, OAuth2EmailAuthConfig } from "@/sources/email/types.js";
import { toUUID } from "@/types/uuid.js";
import { buildXoauth2AuthorizationHeader } from "@/sources/email/xoauth2.js";

interface WrapperMessage {
  id: string;
  checkpoint: string;
  rawData: string;
  receivedAt?: string;
}

interface WrapperResponse {
  items?: WrapperMessage[];
}

export class MailhogOAuthIngestionProvider implements EmailIngestionBoundary {
  private accessTokenCache: { value: string; expiresAtMs: number } | null = null;

  constructor(private readonly config: EmailSourceConfig) {}

  async fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    try {
      return await this.fetchWithAuth(lastCheckpoint, false);
    } catch (error) {
      if (!this.shouldRetryWithFreshToken(error)) {
        throw error;
      }

      logger.warn("email.mailhog.retrying_with_refreshed_token", {
        sourceKey: this.config.key
      });

      return this.fetchWithAuth(lastCheckpoint, true);
    }
  }

  private async fetchWithAuth(lastCheckpoint: string | null, forceTokenRefresh: boolean): Promise<IngestedFile[]> {
    const oauth = this.assertOAuthConfig();
    const accessToken = await this.resolveAccessToken(oauth, forceTokenRefresh);
    const apiBaseUrl = this.config.mailhogApiBaseUrl.replace(/\/+$/, "");
    const response = await axios.get<WrapperResponse>(`${apiBaseUrl}/messages`, {
      params: lastCheckpoint ? { after: lastCheckpoint } : undefined,
      headers: {
        Authorization: buildXoauth2AuthorizationHeader(this.config.username, accessToken)
      },
      timeout: oauth.timeoutMs
    });

    const messages = Array.isArray(response.data?.items) ? response.data.items : [];
    const files: IngestedFile[] = [];

    for (const message of messages) {
      const rawBuffer = Buffer.from(message.rawData ?? "", "base64");
      if (rawBuffer.length === 0) {
        continue;
      }

      const parsedMail = await simpleParser(rawBuffer);
      const from = parsedMail.from?.text ?? "";
      if (this.config.fromFilter && !from.toLowerCase().includes(this.config.fromFilter.toLowerCase())) {
        continue;
      }

      for (const attachment of parsedMail.attachments ?? []) {
        const normalizedMime = normalizeInvoiceMimeType(attachment.contentType ?? "");
        if (!isSupportedInvoiceMimeType(normalizedMime)) {
          continue;
        }

        files.push({
          tenantId: this.config.tenantId ?? toUUID("default"),
          clientOrgId: null,
          workloadTier: this.config.workloadTier ?? "standard",
          sourceKey: this.config.key,
          sourceType: "email",
          sourceDocumentId: message.id,
          attachmentName: attachment.filename ?? `attachment-${message.id}`,
          mimeType: assertDocumentMimeType(normalizedMime),
          receivedAt: normalizeReceivedAt(message.receivedAt, parsedMail.date),
          buffer: attachment.content,
          checkpointValue: message.checkpoint,
          metadata: {
            messageId: parsedMail.messageId ?? message.id,
            subject: parsedMail.subject ?? "",
            from
          }
        });
      }
    }

    files.sort((a, b) => a.checkpointValue.localeCompare(b.checkpointValue));
    return files;
  }

  private assertOAuthConfig(): OAuth2EmailAuthConfig {
    if (this.config.auth.type !== "oauth2") {
      throw new Error("MailHog OAuth provider requires auth.type=oauth2.");
    }
    return this.config.auth;
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
    if (this.config.auth.type !== "oauth2") {
      return false;
    }
    const hasRefreshConfig = Boolean(
      this.config.auth.refreshToken.trim() && this.config.auth.clientId.trim() && this.config.auth.clientSecret.trim()
    );
    if (!hasRefreshConfig) {
      return false;
    }
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes("auth") || message.includes("unauthorized") || message.includes("invalid credentials");
  }
}

function normalizeReceivedAt(receivedAt: string | undefined, parsedDate: Date | undefined): Date {
  if (receivedAt) {
    const parsed = new Date(receivedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return parsedDate ?? new Date();
}
