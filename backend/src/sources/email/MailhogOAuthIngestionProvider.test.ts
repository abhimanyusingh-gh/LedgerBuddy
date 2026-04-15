const axiosGetMock = jest.fn();
const axiosPostMock = jest.fn();
const simpleParserMock = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: (...args: unknown[]) => axiosGetMock(...args),
    post: (...args: unknown[]) => axiosPostMock(...args),
    isAxiosError: (value: unknown) =>
      typeof value === "object" && value !== null && (value as { isAxiosError?: unknown }).isAxiosError === true
  }
}));

jest.mock("mailparser", () => ({
  simpleParser: (...args: unknown[]) => simpleParserMock(...args)
}));

import { MailhogOAuthIngestionProvider } from "@/sources/email/MailhogOAuthIngestionProvider.js";
import type { EmailSourceConfig } from "@/sources/email/types.js";
import { buildXoauth2AuthorizationHeader } from "@/sources/email/xoauth2.js";

function baseConfig(overrides?: Partial<EmailSourceConfig>): EmailSourceConfig {
  return {
    key: "mailhog-oauth",
    tenantId: "tenant-default",
    workloadTier: "standard",
    oauthUserId: "local-user",
    transport: "mailhog_oauth",
    mailhogApiBaseUrl: "http://mailhog-oauth:8026",
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    smtpTimeoutMs: 15000,
    username: "ap@example.com",
    auth: {
      type: "oauth2",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      accessToken: "",
      tokenUrl: "http://mailhog-oauth:8026/oauth/token",
      timeoutMs: 15_000
    },
    mailbox: "INBOX",
    fromFilter: "",
    ...(overrides ?? {})
  };
}

describe("MailhogOAuthIngestionProvider", () => {
  beforeEach(() => {
    axiosGetMock.mockReset();
    axiosPostMock.mockReset();
    simpleParserMock.mockReset();
    simpleParserMock.mockResolvedValue({
      from: { text: "billing@example.com" },
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
  });

  it("refreshes access token and ingests mailhog wrapper messages", async () => {
    axiosPostMock.mockResolvedValue({
      data: {
        access_token: "mailhog-access-token",
        expires_in: 3600
      }
    });
    axiosGetMock.mockResolvedValue({
      data: {
        items: [
          {
            id: "msg-1",
            checkpoint: "2026-02-25T00:00:00.000Z#msg-1",
            receivedAt: "2026-02-25T00:00:00.000Z",
            rawData: Buffer.from("raw-email", "utf8").toString("base64")
          }
        ]
      }
    });

    const provider = new MailhogOAuthIngestionProvider(baseConfig());
    const files = await provider.fetchNewFiles(null);

    expect(files).toHaveLength(1);
    expect(files[0]?.attachmentName).toBe("invoice.pdf");
    expect(files[0]?.sourceDocumentId).toBe("msg-1");
    expect(axiosPostMock).toHaveBeenCalledWith(
      "http://mailhog-oauth:8026/oauth/token",
      expect.stringContaining("grant_type=refresh_token"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded"
        })
      })
    );
    expect(axiosGetMock).toHaveBeenCalledWith(
      "http://mailhog-oauth:8026/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: buildXoauth2AuthorizationHeader("ap@example.com", "mailhog-access-token")
        })
      })
    );
  });

  it("uses static token when provided", async () => {
    axiosGetMock.mockResolvedValue({
      data: { items: [] }
    });

    const provider = new MailhogOAuthIngestionProvider(
      baseConfig({
        auth: {
          type: "oauth2",
          clientId: "",
          clientSecret: "",
          refreshToken: "",
          accessToken: "static-token",
          tokenUrl: "http://mailhog-oauth:8026/oauth/token",
          timeoutMs: 15_000
        }
      })
    );
    await provider.fetchNewFiles(null);

    expect(axiosPostMock).not.toHaveBeenCalled();
    expect(axiosGetMock).toHaveBeenCalledWith(
      "http://mailhog-oauth:8026/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: buildXoauth2AuthorizationHeader("ap@example.com", "static-token")
        })
      })
    );
  });
});
