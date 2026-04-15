import { createHash, randomBytes } from "node:crypto";
import { env } from "@/config/env.js";
import { OAuthStateModel } from "@/models/integration/OAuthState.js";
import { TenantIntegrationModel } from "@/models/integration/TenantIntegration.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import {
  exchangeGoogleAuthorizationCode,
  fetchGoogleUserEmail,
  isInvalidGrantError,
  refreshGoogleAccessToken
} from "@/sources/email/gmailOAuthClient.js";
import { GmailMailboxNeedsReauthError } from "@/sources/email/errors.js";
import { decryptSecret, encryptSecret } from "@/utils/secretCrypto.js";
import { MailboxNotificationService } from "@/services/platform/mailboxNotificationService.js";
import { HttpError } from "@/errors/HttpError.js";

const PROVIDER = "gmail";

interface GmailConnectionStatus {
  provider: "gmail";
  status: "connected" | "requires_reauth" | "error";
  emailAddress: string;
  lastErrorReason: string;
  lastSyncedAt: string;
}

export class TenantGmailIntegrationService {
  constructor(private readonly notificationService: MailboxNotificationService = new MailboxNotificationService()) {}

  async createConnectUrl(input: { tenantId: string; userId: string }): Promise<string> {
    assertGmailOAuthConfigured();

    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(Date.now() + env.GMAIL_OAUTH_STATE_TTL_SECONDS * 1000);

    await OAuthStateModel.create({
      state,
      userId: input.userId,
      tenantId: input.tenantId,
      provider: PROVIDER,
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

  async handleOAuthCallback(code: string, state: string): Promise<{ tenantId: string }> {
    assertGmailOAuthConfigured();
    const oauthState = await OAuthStateModel.findOne({
      state,
      provider: PROVIDER
    });
    if (!oauthState || !oauthState.tenantId) {
      throw new HttpError("OAuth state is invalid or expired.", 400, "gmail_oauth_state_invalid");
    }

    if (oauthState.expiresAt.getTime() < Date.now()) {
      await OAuthStateModel.deleteOne({ _id: oauthState._id });
      throw new HttpError("OAuth state expired. Start connection again.", 400, "gmail_oauth_state_expired");
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
    const encryptedRefreshToken = encryptSecret(tokenResult.refreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET);

    const integration = await TenantIntegrationModel.findOneAndUpdate(
      {
        tenantId: oauthState.tenantId,
        provider: PROVIDER,
        emailAddress
      },
      {
        tenantId: oauthState.tenantId,
        provider: PROVIDER,
        status: "connected",
        emailAddress,
        encryptedRefreshToken,
        createdByUserId: oauthState.userId,
        lastErrorReason: undefined,
        reauthNotifiedAt: undefined
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    await TenantMailboxAssignmentModel.updateOne(
      { tenantId: oauthState.tenantId, integrationId: integration._id, assignedTo: "all" },
      { tenantId: oauthState.tenantId, integrationId: integration._id, assignedTo: "all" },
      { upsert: true }
    );

    return {
      tenantId: oauthState.tenantId
    };
  }

  async getConnectionStatus(tenantId: string): Promise<GmailConnectionStatus> {
    const integration = await TenantIntegrationModel.findOne({
      tenantId,
      provider: PROVIDER
    }).lean();
    if (!integration) {
      return {
        provider: PROVIDER,
        status: "error",
        emailAddress: "",
        lastErrorReason: "",
        lastSyncedAt: ""
      };
    }
    return {
      provider: PROVIDER,
      status: integration.status,
      emailAddress: integration.emailAddress ?? "",
      lastErrorReason: integration.lastErrorReason ?? "",
      lastSyncedAt: integration.lastSyncedAt ? integration.lastSyncedAt.toISOString() : ""
    };
  }

  async resolveIngestionCredentials(tenantId: string): Promise<{ emailAddress: string; accessToken: string } | null> {
    const integration = await TenantIntegrationModel.findOne({
      tenantId,
      provider: PROVIDER
    });
    if (!integration) {
      return null;
    }
    if (integration.status === "requires_reauth") {
      throw new GmailMailboxNeedsReauthError(integration.lastErrorReason ?? "Mailbox requires reauthorization.");
    }

    const encryptedRefreshToken = integration.encryptedRefreshToken ?? "";
    if (!encryptedRefreshToken) {
      integration.status = "error";
      integration.lastErrorReason = "Missing refresh token.";
      await integration.save();
      throw new GmailMailboxNeedsReauthError("Missing refresh token.");
    }

    let refreshToken = "";
    try {
      refreshToken = decryptSecret(encryptedRefreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Refresh token decryption failed.";
      await this.transitionToNeedsReauth(integration, reason);
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
        emailAddress: integration.emailAddress ?? "",
        accessToken: refreshed.accessToken
      };
    } catch (error) {
      if (isInvalidGrantError(error)) {
        const reason =
          error instanceof Error ? `OAuth refresh token rejected: ${error.message}` : "OAuth refresh token rejected.";
        await this.transitionToNeedsReauth(integration, reason);
        throw new GmailMailboxNeedsReauthError(reason);
      }
      throw error;
    }
  }

  async markSyncSuccess(tenantId: string): Promise<void> {
    await TenantIntegrationModel.findOneAndUpdate(
      {
        tenantId,
        provider: PROVIDER
      },
      {
        status: "connected",
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
    integration: {
      status: "connected" | "requires_reauth" | "error";
      tenantId: string;
      createdByUserId: string;
      emailAddress?: string | null;
      lastErrorReason?: string | null;
      reauthNotifiedAt?: Date | null;
      save(): Promise<unknown>;
    },
    reason: string
  ): Promise<void> {
    const previousStatus = integration.status;
    integration.status = "requires_reauth";
    integration.lastErrorReason = reason;

    if (previousStatus === "connected") {
      integration.reauthNotifiedAt = new Date();
      await integration.save();
      await this.notificationService.notifyNeedsReauth({
        userId: integration.createdByUserId,
        provider: PROVIDER,
        emailAddress: integration.emailAddress ?? "",
        reason
      });
      return;
    }

    await integration.save();
  }

  async updatePollingConfig(
    integrationId: string,
    tenantId: string,
    input: { enabled: boolean; intervalHours: number }
  ): Promise<void> {
    const integration = await TenantIntegrationModel.findOne({ _id: integrationId, tenantId });
    if (!integration) {
      throw new HttpError("Integration not found.", 404, "integration_not_found");
    }
    if (integration.status !== "connected") {
      throw new HttpError("Polling can only be enabled on connected integrations.", 400, "integration_not_connected");
    }

    const { ALLOWED_POLLING_INTERVALS_HOURS } = await import("../../models/integration/TenantIntegration.js");
    if (!ALLOWED_POLLING_INTERVALS_HOURS.includes(input.intervalHours as 1 | 2 | 4 | 8)) {
      throw new HttpError(`Polling interval must be one of: ${ALLOWED_POLLING_INTERVALS_HOURS.join(", ")} hours.`, 400, "invalid_polling_interval");
    }

    const now = new Date();
    const nextPollAfter = input.enabled ? new Date(now.getTime() + input.intervalHours * 3600_000) : undefined;

    integration.set("pollingConfig", {
      enabled: input.enabled,
      intervalHours: input.intervalHours,
      lastPolledAt: integration.get("pollingConfig")?.lastPolledAt ?? undefined,
      nextPollAfter
    });
    await integration.save();
  }

  async getPollingEligibleIntegrations(): Promise<Array<{ tenantId: string; integrationId: string }>> {
    const now = new Date();
    const integrations = await TenantIntegrationModel.find({
      provider: "gmail",
      status: "connected",
      "pollingConfig.enabled": true,
      "pollingConfig.nextPollAfter": { $lte: now }
    }).select({ tenantId: 1 }).lean();

    return integrations.map((i) => ({
      tenantId: i.tenantId,
      integrationId: String(i._id)
    }));
  }

  async markPollingCompleted(integrationId: string): Promise<void> {
    const integration = await TenantIntegrationModel.findById(integrationId);
    if (!integration?.pollingConfig) return;
    const now = new Date();
    integration.pollingConfig.lastPolledAt = now;
    integration.pollingConfig.nextPollAfter = new Date(now.getTime() + (integration.pollingConfig.intervalHours ?? 4) * 3600_000);
    await integration.save();
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
    ["GMAIL_OAUTH_SCOPES", env.GMAIL_OAUTH_SCOPES]
  ]
    .filter(([, value]) => value.trim().length === 0)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`Gmail OAuth configuration is missing fields: ${missing.join(", ")}`);
  }
}
