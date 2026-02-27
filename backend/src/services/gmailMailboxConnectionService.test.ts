const envMock = {
  GMAIL_OAUTH_CLIENT_ID: "client-id",
  GMAIL_OAUTH_CLIENT_SECRET: "client-secret",
  GMAIL_OAUTH_REDIRECT_URI: "http://localhost:4000/connect/gmail/callback",
  GMAIL_OAUTH_AUTH_URL: "https://accounts.google.com/o/oauth2/v2/auth",
  GMAIL_OAUTH_TOKEN_URL: "https://oauth2.googleapis.com/token",
  GMAIL_OAUTH_USERINFO_URL: "https://openidconnect.googleapis.com/v1/userinfo",
  GMAIL_OAUTH_SCOPES: "https://mail.google.com/ openid email profile",
  GMAIL_OAUTH_STATE_TTL_SECONDS: 600,
  GMAIL_OAUTH_HTTP_TIMEOUT_MS: 15000,
  GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET: "test-secret-passphrase-123456",
  GMAIL_OAUTH_SUCCESS_REDIRECT_URL: "http://localhost:5173",
  GMAIL_OAUTH_FAILURE_REDIRECT_URL: "http://localhost:5173"
};

let oauthStateRecord:
  | {
      _id: string;
      state: string;
      userId: string;
      provider: "gmail";
      codeVerifier: string;
      expiresAt: Date;
    }
  | null;

let mailboxConnectionRecord:
  | {
      userId: string;
      provider: "gmail";
      emailAddress: string;
      refreshTokenEncrypted: string;
      connectionState: "CONNECTED" | "NEEDS_REAUTH";
      lastErrorReason?: string | null;
      lastSyncedAt?: Date;
      reauthNotifiedAt?: Date | null;
      save: () => Promise<void>;
    }
  | null;

const oauthCreateMock = jest.fn();
const oauthFindOneMock = jest.fn();
const oauthDeleteOneMock = jest.fn();
const mailboxFindOneMock = jest.fn();
const mailboxFindOneAndUpdateMock = jest.fn();
const exchangeGoogleAuthorizationCodeMock = jest.fn();
const fetchGoogleUserEmailMock = jest.fn();
const refreshGoogleAccessTokenMock = jest.fn();
const isInvalidGrantErrorMock = jest.fn();
const encryptSecretMock = jest.fn();
const decryptSecretMock = jest.fn();

jest.mock("../config/env.js", () => ({
  env: envMock
}));

jest.mock("../models/OAuthState.js", () => ({
  OAuthStateModel: {
    create: (...args: unknown[]) => oauthCreateMock(...args),
    findOne: (...args: unknown[]) => oauthFindOneMock(...args),
    deleteOne: (...args: unknown[]) => oauthDeleteOneMock(...args)
  }
}));

jest.mock("../models/MailboxConnection.js", () => ({
  MailboxConnectionModel: {
    findOne: (...args: unknown[]) => mailboxFindOneMock(...args),
    findOneAndUpdate: (...args: unknown[]) => mailboxFindOneAndUpdateMock(...args)
  }
}));

jest.mock("../sources/email/gmailOAuthClient.js", () => ({
  exchangeGoogleAuthorizationCode: (...args: unknown[]) => exchangeGoogleAuthorizationCodeMock(...args),
  fetchGoogleUserEmail: (...args: unknown[]) => fetchGoogleUserEmailMock(...args),
  refreshGoogleAccessToken: (...args: unknown[]) => refreshGoogleAccessTokenMock(...args),
  isInvalidGrantError: (...args: unknown[]) => isInvalidGrantErrorMock(...args)
}));

jest.mock("../utils/secretCrypto.js", () => ({
  encryptSecret: (...args: unknown[]) => encryptSecretMock(...args),
  decryptSecret: (...args: unknown[]) => decryptSecretMock(...args)
}));

import { GmailMailboxConnectionService } from "./gmailMailboxConnectionService.js";
import { GmailMailboxNeedsReauthError } from "../sources/email/errors.js";

describe("GmailMailboxConnectionService", () => {
  beforeEach(() => {
    oauthStateRecord = null;
    mailboxConnectionRecord = null;

    oauthCreateMock.mockReset();
    oauthFindOneMock.mockReset();
    oauthDeleteOneMock.mockReset();
    mailboxFindOneMock.mockReset();
    mailboxFindOneAndUpdateMock.mockReset();
    exchangeGoogleAuthorizationCodeMock.mockReset();
    fetchGoogleUserEmailMock.mockReset();
    refreshGoogleAccessTokenMock.mockReset();
    isInvalidGrantErrorMock.mockReset();
    encryptSecretMock.mockReset();
    decryptSecretMock.mockReset();

    oauthCreateMock.mockImplementation(async (payload: typeof oauthStateRecord) => {
      oauthStateRecord = payload;
      return payload;
    });
    oauthFindOneMock.mockImplementation(async (query: { state: string }) =>
      oauthStateRecord && oauthStateRecord.state === query.state ? oauthStateRecord : null
    );
    oauthDeleteOneMock.mockImplementation(async () => {
      oauthStateRecord = null;
    });

    mailboxFindOneMock.mockImplementation(async (query: { userId: string; provider: string }) =>
      mailboxConnectionRecord &&
      mailboxConnectionRecord.userId === query.userId &&
      mailboxConnectionRecord.provider === query.provider
        ? mailboxConnectionRecord
        : null
    );

    mailboxFindOneAndUpdateMock.mockImplementation(
      async (
        _query: unknown,
        payload: Partial<{
          userId: string;
          provider: "gmail";
          emailAddress: string;
          refreshTokenEncrypted: string;
          connectionState: "CONNECTED" | "NEEDS_REAUTH";
          lastErrorReason?: string;
          reauthNotifiedAt?: Date;
          lastSyncedAt?: Date;
        }>
      ) => {
        mailboxConnectionRecord = createConnectionRecord({
          userId: payload.userId ?? mailboxConnectionRecord?.userId ?? "local-user",
          provider: payload.provider ?? mailboxConnectionRecord?.provider ?? "gmail",
          emailAddress: payload.emailAddress ?? mailboxConnectionRecord?.emailAddress ?? "ap@example.com",
          refreshTokenEncrypted:
            payload.refreshTokenEncrypted ?? mailboxConnectionRecord?.refreshTokenEncrypted ?? "encrypted-token",
          connectionState: payload.connectionState ?? mailboxConnectionRecord?.connectionState ?? "CONNECTED",
          lastErrorReason: payload.lastErrorReason ?? mailboxConnectionRecord?.lastErrorReason,
          reauthNotifiedAt: payload.reauthNotifiedAt ?? mailboxConnectionRecord?.reauthNotifiedAt,
          lastSyncedAt: payload.lastSyncedAt ?? mailboxConnectionRecord?.lastSyncedAt
        });
        return mailboxConnectionRecord;
      }
    );

    exchangeGoogleAuthorizationCodeMock.mockResolvedValue({
      accessToken: "access-token-1",
      refreshToken: "refresh-token-1",
      expiresInSeconds: 3600
    });
    fetchGoogleUserEmailMock.mockResolvedValue("ap@example.com");
    refreshGoogleAccessTokenMock.mockResolvedValue({
      accessToken: "runtime-access-token",
      expiresInSeconds: 3600
    });
    isInvalidGrantErrorMock.mockReturnValue(false);
    encryptSecretMock.mockReturnValue("encrypted-refresh-token");
    decryptSecretMock.mockReturnValue("refresh-token-1");
  });

  it("creates oauth connect URL and persists state", async () => {
    const service = new GmailMailboxConnectionService({
      notifyNeedsReauth: jest.fn()
    } as unknown as { notifyNeedsReauth: () => Promise<void> });

    const redirectUrl = await service.createConnectUrl("local-user");
    const parsed = new URL(redirectUrl);

    expect(parsed.origin + parsed.pathname).toBe(envMock.GMAIL_OAUTH_AUTH_URL);
    expect(parsed.searchParams.get("client_id")).toBe(envMock.GMAIL_OAUTH_CLIENT_ID);
    expect(parsed.searchParams.get("redirect_uri")).toBe(envMock.GMAIL_OAUTH_REDIRECT_URI);
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("state")).toBeTruthy();
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(oauthCreateMock).toHaveBeenCalledTimes(1);
  });

  it("handles callback and marks connection as CONNECTED", async () => {
    oauthStateRecord = {
      _id: "state-1",
      state: "state-value",
      userId: "local-user",
      provider: "gmail",
      codeVerifier: "code-verifier",
      expiresAt: new Date(Date.now() + 10_000)
    };

    const service = new GmailMailboxConnectionService({
      notifyNeedsReauth: jest.fn()
    } as unknown as { notifyNeedsReauth: () => Promise<void> });

    const status = await service.handleOAuthCallback("auth-code", "state-value");

    expect(exchangeGoogleAuthorizationCodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "auth-code",
        codeVerifier: "code-verifier"
      })
    );
    expect(fetchGoogleUserEmailMock).toHaveBeenCalledWith(
      "access-token-1",
      envMock.GMAIL_OAUTH_USERINFO_URL,
      envMock.GMAIL_OAUTH_HTTP_TIMEOUT_MS
    );
    expect(encryptSecretMock).toHaveBeenCalledWith("refresh-token-1", envMock.GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET);
    expect(status.connectionState).toBe("CONNECTED");
    expect(status.emailAddress).toBe("ap@example.com");
  });

  it("transitions to NEEDS_REAUTH once on invalid_grant and throws", async () => {
    const notifyNeedsReauth = jest.fn().mockResolvedValue(undefined);
    mailboxConnectionRecord = createConnectionRecord({
      userId: "local-user",
      provider: "gmail",
      emailAddress: "ap@example.com",
      refreshTokenEncrypted: "enc-token",
      connectionState: "CONNECTED"
    });

    const invalidGrantError = new Error("invalid grant");
    refreshGoogleAccessTokenMock.mockRejectedValue(invalidGrantError);
    isInvalidGrantErrorMock.mockImplementation((error: unknown) => error === invalidGrantError);

    const service = new GmailMailboxConnectionService({
      notifyNeedsReauth
    } as unknown as { notifyNeedsReauth: () => Promise<void> });

    await expect(service.resolveIngestionCredentials("local-user")).rejects.toBeInstanceOf(GmailMailboxNeedsReauthError);
    expect(mailboxConnectionRecord?.connectionState).toBe("NEEDS_REAUTH");
    expect(mailboxConnectionRecord?.lastErrorReason).toContain("OAuth refresh token rejected");
    expect(notifyNeedsReauth).toHaveBeenCalledTimes(1);

    await expect(service.resolveIngestionCredentials("local-user")).rejects.toBeInstanceOf(GmailMailboxNeedsReauthError);
    expect(notifyNeedsReauth).toHaveBeenCalledTimes(1);
  });
});

function createConnectionRecord(input: {
  userId: string;
  provider: "gmail";
  emailAddress: string;
  refreshTokenEncrypted: string;
  connectionState: "CONNECTED" | "NEEDS_REAUTH";
  lastErrorReason?: string | null;
  reauthNotifiedAt?: Date | null;
  lastSyncedAt?: Date;
}) {
  const record = {
    ...input,
    save: async () => {
      mailboxConnectionRecord = record;
    }
  };
  return record;
}
