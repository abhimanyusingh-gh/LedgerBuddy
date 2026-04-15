import { buildIngestionSources } from "@/core/sourceRegistry.js";
import type { IngestionSourceManifest } from "@/core/runtimeManifest.js";

function buildEmailSource(overrides?: Partial<Extract<IngestionSourceManifest, { type: "email" }>>): IngestionSourceManifest {
  return {
    type: "email",
    key: "gmail-inbox",
    tenantId: "tenant-1",
    workloadTier: "standard",
    oauthUserId: "local-user",
    transport: "imap",
    mailhogApiBaseUrl: "http://mailhog-oauth:8026",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpTimeoutMs: 15000,
    username: "invoice@example.com",
    authMode: "password",
    password: "app-password",
    oauth2: {
      clientId: "",
      clientSecret: "",
      refreshToken: "",
      accessToken: "",
      tokenEndpoint: "https://oauth2.googleapis.com/token"
    },
    mailbox: "INBOX",
    fromFilter: "",
    ...(overrides ?? {})
  };
}

describe("buildIngestionSources", () => {
  it("builds an email ingestion source using password auth", () => {
    const sources = buildIngestionSources([buildEmailSource()]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe("email");
    expect(sources[0]?.key).toBe("gmail-inbox");
  });

  it("throws when password auth is selected without password", () => {
    expect(() =>
      buildIngestionSources([
        buildEmailSource({
          password: ""
        })
      ])
    ).toThrow("Email source password auth selected but EMAIL_PASSWORD is missing.");
  });

  it("builds an email source for oauth2 auth with static access token", () => {
    const sources = buildIngestionSources([
      buildEmailSource({
        authMode: "oauth2",
        password: "",
        oauth2: {
          clientId: "",
          clientSecret: "",
          refreshToken: "",
          accessToken: "ya29.static-token",
          tokenEndpoint: "https://oauth2.googleapis.com/token"
        }
      })
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe("email");
  });

  it("allows oauth2 source without static token credentials when oauthUserId is configured", () => {
    const sources = buildIngestionSources([
      buildEmailSource({
        authMode: "oauth2",
        password: "",
        oauth2: {
          clientId: "",
          clientSecret: "",
          refreshToken: "",
          accessToken: "",
          tokenEndpoint: ""
        }
      })
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]?.type).toBe("email");
  });

  it("throws when oauth2 source has no oauthUserId and no token credentials", () => {
    expect(() =>
      buildIngestionSources([
        buildEmailSource({
          oauthUserId: "",
          authMode: "oauth2",
          password: "",
          oauth2: {
            clientId: "",
            clientSecret: "",
            refreshToken: "",
            accessToken: "",
            tokenEndpoint: ""
          }
        })
      ])
    ).toThrow(
      "Email source OAuth2 selected but credentials are incomplete. Provide access token or client_id/client_secret/refresh_token/token_endpoint."
    );
  });

  it("requires oauth mode for mailhog_oauth transport", () => {
    expect(() =>
      buildIngestionSources([
        buildEmailSource({
          transport: "mailhog_oauth",
          authMode: "password"
        })
      ])
    ).toThrow("MailHog OAuth source requires EMAIL_AUTH_MODE=oauth2.");
  });

  it("requires mailhog api base url for mailhog_oauth transport", () => {
    expect(() =>
      buildIngestionSources([
        buildEmailSource({
          transport: "mailhog_oauth",
          authMode: "oauth2",
          password: "",
          mailhogApiBaseUrl: "",
          oauth2: {
            clientId: "",
            clientSecret: "",
            refreshToken: "",
            accessToken: "token",
            tokenEndpoint: "https://oauth2.googleapis.com/token"
          }
        })
      ])
    ).toThrow("MailHog OAuth source selected but EMAIL_MAILHOG_API_BASE_URL is missing.");
  });
});
