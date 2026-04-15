const axiosPostMock = jest.fn();
const simpleParserMock = jest.fn();
const connectMock = jest.fn();
const mailboxOpenMock = jest.fn();
const logoutMock = jest.fn();
const verifySmtpXoauth2Mock = jest.fn();
let fetchMessages: Array<{
  uid: number;
  source: Buffer;
  internalDate?: Date;
}> = [];
let capturedOptions: unknown;

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => axiosPostMock(...args)
  }
}));

jest.mock("mailparser", () => ({
  simpleParser: (...args: unknown[]) => simpleParserMock(...args)
}));

jest.mock("./email/smtpXoauth2Probe.js", () => ({
  verifySmtpXoauth2: (...args: unknown[]) => verifySmtpXoauth2Mock(...args)
}));

jest.mock("imapflow", () => ({
  ImapFlow: jest.fn().mockImplementation((options: unknown) => {
    capturedOptions = options;
    return {
      connect: connectMock,
      mailboxOpen: mailboxOpenMock,
      fetch: () =>
        (async function* () {
          for (const message of fetchMessages) {
            yield message;
          }
        })(),
      logout: logoutMock
    };
  })
}));

import { EmailIngestionSource, type EmailSourceConfig } from "@/sources/EmailIngestionSource.js";

function baseConfig(overrides?: Partial<EmailSourceConfig>): EmailSourceConfig {
  return {
    key: "gmail-imap",
    tenantId: "tenant-default",
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
    auth: {
      type: "password",
      password: "app-password"
    },
    mailbox: "INBOX",
    fromFilter: "",
    ...(overrides ?? {})
  };
}

describe("EmailIngestionSource", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    simpleParserMock.mockReset();
    connectMock.mockReset();
    mailboxOpenMock.mockReset();
    logoutMock.mockReset();
    verifySmtpXoauth2Mock.mockReset();
    capturedOptions = undefined;
    fetchMessages = [];

    connectMock.mockResolvedValue(undefined);
    mailboxOpenMock.mockResolvedValue(undefined);
    logoutMock.mockResolvedValue(undefined);
    simpleParserMock.mockResolvedValue({
      from: { text: "billing@vendor.example" },
      messageId: "message-1",
      subject: "Invoice",
      date: new Date("2026-02-25T00:00:00.000Z"),
      attachments: [
        {
          contentType: "application/pdf",
          filename: "invoice.pdf",
          content: Buffer.from("pdf-bytes")
        }
      ]
    });
    verifySmtpXoauth2Mock.mockResolvedValue(undefined);
  });

  it("uses password auth when authMode=password", async () => {
    fetchMessages = [{ uid: 1, source: Buffer.from("raw"), internalDate: new Date("2026-02-24T00:00:00.000Z") }];
    const source = new EmailIngestionSource(baseConfig());
    const files = await source.fetchNewFiles(null);

    expect(files).toHaveLength(1);
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          user: "invoice@example.com",
          pass: "app-password"
        })
      })
    );
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("uses static oauth2 access token when provided", async () => {
    fetchMessages = [{ uid: 2, source: Buffer.from("raw") }];
    const source = new EmailIngestionSource(
      baseConfig({
        auth: {
          type: "oauth2",
          clientId: "",
          clientSecret: "",
          refreshToken: "",
          accessToken: "ya29.static-token",
          tokenUrl: "https://oauth2.googleapis.com/token",
          timeoutMs: 15_000
        }
      })
    );
    await source.fetchNewFiles(null);

    expect(capturedOptions).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          user: "invoice@example.com",
          accessToken: "ya29.static-token"
        })
      })
    );
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  it("refreshes oauth2 token when static access token is missing", async () => {
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: "ya29.refreshed-token"
      }
    });
    fetchMessages = [{ uid: 3, source: Buffer.from("raw") }];

    const source = new EmailIngestionSource(
      baseConfig({
        auth: {
          type: "oauth2",
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          accessToken: "",
          tokenUrl: "https://oauth2.googleapis.com/token",
          timeoutMs: 15_000
        }
      })
    );
    await source.fetchNewFiles(null);

    expect(axiosPostMock).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/token",
      expect.stringContaining("grant_type=refresh_token"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded"
        })
      })
    );
    expect(capturedOptions).toEqual(
      expect.objectContaining({
        auth: expect.objectContaining({
          user: "invoice@example.com",
          accessToken: "ya29.refreshed-token"
        })
      })
    );
  });

  it("rejects insecure Gmail configuration", () => {
    expect(
      () =>
        new EmailIngestionSource(
          baseConfig({
            secure: false
          })
        )
    ).toThrow("Gmail IMAP requires TLS. Set EMAIL_SECURE=true.");
  });
});
