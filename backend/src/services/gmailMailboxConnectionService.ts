import { createHash, randomBytes } from "node:crypto";
import type { GmailIngestionCredentials, GmailMailboxBoundary } from "../core/boundaries/GmailMailboxBoundary.js";
import { env } from "../config/env.js";
import { MailboxConnectionModel } from "../models/MailboxConnection.js";
import { OAuthStateModel } from "../models/OAuthState.js";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserEmail,
  isInvalidGrantError,
  refreshGoogleAccessToken
} from "../sources/email/gmailOAuthClient.js";
import { GmailMailboxNeedsReauthError } from "../sources/email/errors.js";
import { logger } from "../utils/logger.js";
import { decryptSecret, encryptSecret } from "../utils/secretCrypto.js";
import { MailboxNotificationService } from "./mailboxNotificationService.js";

const GMAIL_PROVIDER = "gmail";

interface GmailConnectionStatus {
  provider: "gmail";
  emailAddress: string | null;
  connectionState: "DISCONNECTED" | "CONNECTED" | "NEEDS_REAUTH";
  lastErrorReason: string | null;
  lastSyncedAt: string | null;
}

export class GmailMailboxConnectionService implements GmailMailboxBoundary {
  constructor(private readonly notificationService: MailboxNotificationService = new MailboxNotificationService()) {}

  async createConnectUrl(userId: string): Promise<string> {
    assertGmailOAuthConfigured();

    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(Date.now() + env.GMAIL_OAUTH_STATE_TTL_SECONDS * 1000);

    await OAuthStateModel.create({
      state,
      userId,
      provider: GMAIL_PROVIDER,
      codeVerifier,
      expiresAt
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: env.GMAIL_OAUTH_CLIENT_ID,
      redirect_uri: env.GMAIL_OAUTH_REDIRECT_URI,
      scope: env.GMAIL_OAUTH_SCOPES,
      access_type: "offline",
      include_granted_scopes: "true",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state
    });

    return `${env.GMAIL_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  async handleOAuthCallback(code: string, state: string): Promise<GmailConnectionStatus> {
    assertGmailOAuthConfigured();

    const oauthState = await OAuthStateModel.findOne({
      state,
      provider: GMAIL_PROVIDER
    });
    if (!oauthState) {
      throw new Error("OAuth state is invalid or expired.");
    }

    if (oauthState.expiresAt.getTime() < Date.now()) {
      await OAuthStateModel.deleteOne({ _id: oauthState._id });
      throw new Error("OAuth state expired. Start the connection flow again.");
    }

    await OAuthStateModel.deleteOne({ _id: oauthState._id });

    const tokenResult = await exchangeGoogleAuthorizationCode({
      code,
      codeVerifier: oauthState.codeVerifier,
      clientId: env.GMAIL_OAUTH_CLIENT_ID,
      clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
      redirectUri: env.GMAIL_OAUTH_REDIRECT_URI,
      tokenEndpoint: env.GMAIL_OAUTH_TOKEN_URL,
      timeoutMs: env.GMAIL_OAUTH_HTTP_TIMEOUT_MS
    });

    const emailAddress = await fetchGoogleUserEmail(
      tokenResult.accessToken,
      env.GMAIL_OAUTH_USERINFO_URL,
      env.GMAIL_OAUTH_HTTP_TIMEOUT_MS
    );

    const encryptedRefreshToken = encryptSecret(tokenResult.refreshToken, env.GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET);

    await MailboxConnectionModel.findOneAndUpdate(
      {
        userId: oauthState.userId,
        provider: GMAIL_PROVIDER
      },
      {
        userId: oauthState.userId,
        provider: GMAIL_PROVIDER,
        emailAddress,
        refreshTokenEncrypted: encryptedRefreshToken,
        connectionState: "CONNECTED",
        lastErrorReason: undefined,
        reauthNotifiedAt: undefined
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    logger.info("gmail.connection.connected", {
      userId: oauthState.userId,
      emailAddress
    });

    return this.getConnectionStatus(oauthState.userId);
  }

  async getConnectionStatus(userId: string): Promise<GmailConnectionStatus> {
    const connection = await MailboxConnectionModel.findOne({
      userId,
      provider: GMAIL_PROVIDER
    });

    if (!connection) {
      return {
        provider: GMAIL_PROVIDER,
        connectionState: "DISCONNECTED",
        emailAddress: null,
        lastErrorReason: null,
        lastSyncedAt: null
      };
    }

    return {
      provider: GMAIL_PROVIDER,
      connectionState: connection.connectionState,
      emailAddress: connection.emailAddress,
      lastErrorReason: connection.lastErrorReason ?? null,
      lastSyncedAt: connection.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null
    };
  }

  async resolveIngestionCredentials(userId: string): Promise<GmailIngestionCredentials | null> {
    const connection = await MailboxConnectionModel.findOne({
      userId,
      provider: GMAIL_PROVIDER
    });
    if (!connection) {
      return null;
    }

    if (connection.connectionState === "NEEDS_REAUTH") {
      throw new GmailMailboxNeedsReauthError(
        connection.lastErrorReason || "Mailbox access requires reauthorization."
      );
    }

    let refreshToken = "";
    try {
      refreshToken = decryptSecret(connection.refreshTokenEncrypted, env.GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Failed to decrypt refresh token.";
      await this.transitionToNeedsReauth(connection, reason);
      throw new GmailMailboxNeedsReauthError(reason);
    }

    try {
      const refreshed = await refreshGoogleAccessToken({
        clientId: env.GMAIL_OAUTH_CLIENT_ID,
        clientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
        refreshToken,
        tokenEndpoint: env.GMAIL_OAUTH_TOKEN_URL,
        timeoutMs: env.GMAIL_OAUTH_HTTP_TIMEOUT_MS
      });

      return {
        emailAddress: connection.emailAddress,
        accessToken: refreshed.accessToken
      };
    } catch (error) {
      if (isInvalidGrantError(error)) {
        const reason =
          error instanceof Error ? `OAuth refresh token rejected: ${error.message}` : "OAuth refresh token rejected.";
        await this.transitionToNeedsReauth(connection, reason);
        throw new GmailMailboxNeedsReauthError(reason);
      }
      throw error;
    }
  }

  async markSyncSuccess(userId: string): Promise<void> {
    await MailboxConnectionModel.findOneAndUpdate(
      {
        userId,
        provider: GMAIL_PROVIDER
      },
      {
        connectionState: "CONNECTED",
        lastErrorReason: undefined,
        lastSyncedAt: new Date()
      }
    );
  }

  buildSuccessRedirectUrl(): string {
    return buildRedirectUrl(env.GMAIL_OAUTH_SUCCESS_REDIRECT_URL, {
      gmail: "connected"
    });
  }

  buildFailureRedirectUrl(reason: string): string {
    return buildRedirectUrl(env.GMAIL_OAUTH_FAILURE_REDIRECT_URL, {
      gmail: "error",
      reason
    });
  }

  private async transitionToNeedsReauth(
    connection: {
      userId: string;
      provider: "gmail";
      emailAddress: string;
      connectionState: "CONNECTED" | "NEEDS_REAUTH";
      lastErrorReason?: string | null;
      reauthNotifiedAt?: Date | null;
      save(): Promise<unknown>;
    },
    reason: string
  ): Promise<void> {
    const previousState = connection.connectionState;
    connection.connectionState = "NEEDS_REAUTH";
    connection.lastErrorReason = reason;

    if (previousState === "CONNECTED") {
      connection.reauthNotifiedAt = new Date();
      await connection.save();
      try {
        await this.notificationService.notifyNeedsReauth({
          userId: connection.userId,
          provider: GMAIL_PROVIDER,
          emailAddress: connection.emailAddress,
          reason
        });
      } catch (error) {
        logger.error("gmail.connection.notification.failed", {
          userId: connection.userId,
          emailAddress: connection.emailAddress,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
      return;
    }

    await connection.save();
  }
}

function buildRedirectUrl(baseUrl: string, query: Record<string, string>): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function assertGmailOAuthConfigured(): void {
  const missing = [
    ["GMAIL_OAUTH_CLIENT_ID", env.GMAIL_OAUTH_CLIENT_ID],
    ["GMAIL_OAUTH_CLIENT_SECRET", env.GMAIL_OAUTH_CLIENT_SECRET],
    ["GMAIL_OAUTH_REDIRECT_URI", env.GMAIL_OAUTH_REDIRECT_URI],
    ["GMAIL_OAUTH_AUTH_URL", env.GMAIL_OAUTH_AUTH_URL],
    ["GMAIL_OAUTH_TOKEN_URL", env.GMAIL_OAUTH_TOKEN_URL],
    ["GMAIL_OAUTH_USERINFO_URL", env.GMAIL_OAUTH_USERINFO_URL],
    ["GMAIL_OAUTH_SCOPES", env.GMAIL_OAUTH_SCOPES],
    ["GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET", env.GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET]
  ]
    .filter(([, value]) => value.trim().length === 0)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Gmail OAuth is not configured. Missing: ${missing.join(", ")}`);
  }
}
