const axiosPostMock = jest.fn();
const sendMailMock = jest.fn();
const createTransportMock = jest.fn((_config: unknown) => ({ sendMail: sendMailMock }));

const mockEnv = {
  INVITE_EMAIL_PROVIDER: "smtp" as "smtp" | "sendgrid",
  INVITE_SMTP_HOST: "mailhog",
  INVITE_SMTP_PORT: 1025,
  INVITE_SMTP_SECURE: false,
  INVITE_SMTP_USERNAME: "",
  INVITE_SMTP_PASSWORD: "",
  INVITE_SENDGRID_API_KEY: "",
  INVITE_SENDGRID_ENDPOINT: "https://api.sendgrid.com/v3/mail/send",
  INVITE_SENDGRID_TIMEOUT_MS: 15000
};

jest.mock("axios", () => ({
  __esModule: true,
  default: { post: (...args: unknown[]) => axiosPostMock(...args) }
}));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: (config: unknown) => createTransportMock(config) }
}));

jest.mock("../../config/env.js", () => ({ env: mockEnv }));

const smtpCtorMock = jest.fn((_config: unknown) => ({ provider: "smtp" }));
const sendGridCtorMock = jest.fn((_config: unknown) => ({ provider: "sendgrid" }));

jest.mock("./SmtpInviteEmailSenderProvider.js", () => ({
  SmtpInviteEmailSenderProvider: jest.fn().mockImplementation((config: unknown) => smtpCtorMock(config))
}));

jest.mock("./SendGridInviteEmailSenderProvider.js", () => ({
  SendGridInviteEmailSenderProvider: jest.fn().mockImplementation((config: unknown) => sendGridCtorMock(config))
}));

import { createInviteEmailSenderProvider } from "@/providers/email/createInviteEmailSenderProvider.ts";

describe("createInviteEmailSenderProvider", () => {
  beforeEach(() => {
    mockEnv.INVITE_EMAIL_PROVIDER = "smtp";
    mockEnv.INVITE_SENDGRID_API_KEY = "";
    smtpCtorMock.mockClear();
    sendGridCtorMock.mockClear();
  });

  it("throws when sendgrid provider is selected without api key", () => {
    mockEnv.INVITE_EMAIL_PROVIDER = "sendgrid";
    expect(() => createInviteEmailSenderProvider()).toThrow(
      "INVITE_SENDGRID_API_KEY is required when INVITE_EMAIL_PROVIDER=sendgrid."
    );
  });
});

describe("SendGridInviteEmailSenderProvider", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    axiosPostMock.mockResolvedValue({ status: 202 });
  });

  it("sends invite email through SendGrid API", async () => {
    const { SendGridInviteEmailSenderProvider: RealSendGrid } = jest.requireActual("./SendGridInviteEmailSenderProvider.ts") as typeof import("./SendGridInviteEmailSenderProvider.ts");
    const provider = new RealSendGrid({
      apiKey: "sg-token",
      endpoint: "https://api.sendgrid.com/v3/mail/send/",
      timeoutMs: 5000
    });

    await provider.send({
      from: "from@example.com", to: "to@example.com",
      subject: "Invite", text: "hello"
    });

    expect(axiosPostMock).toHaveBeenCalledWith(
      "https://api.sendgrid.com/v3/mail/send",
      {
        personalizations: [{ to: [{ email: "to@example.com" }] }],
        from: { email: "from@example.com" },
        subject: "Invite",
        content: [{ type: "text/plain", value: "hello" }]
      },
      {
        timeout: 5000,
        headers: {
          Authorization: "Bearer sg-token",
          "Content-Type": "application/json"
        }
      }
    );
  });
});

describe("SmtpInviteEmailSenderProvider", () => {
  beforeEach(() => {
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
  });

  it("creates SMTP transport with auth when credentials are provided", async () => {
    const { SmtpInviteEmailSenderProvider: RealSmtp } = jest.requireActual("./SmtpInviteEmailSenderProvider.ts") as typeof import("./SmtpInviteEmailSenderProvider.ts");
    const provider = new RealSmtp({
      host: "smtp.example.com", port: 465, secure: true,
      username: "user", password: "pass"
    });

    await provider.send({
      from: "from@example.com", to: "to@example.com",
      subject: "Invite", text: "hello"
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com", port: 465, secure: true,
      ignoreTLS: false, auth: { user: "user", pass: "pass" }
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "from@example.com", to: "to@example.com",
      subject: "Invite", text: "hello"
    });
  });

  it("creates SMTP transport without auth when credentials are missing", () => {
    const { SmtpInviteEmailSenderProvider: RealSmtp } = jest.requireActual("./SmtpInviteEmailSenderProvider.ts") as typeof import("./SmtpInviteEmailSenderProvider.ts");
    new RealSmtp({
      host: "smtp.example.com", port: 1025, secure: false
    });
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com", port: 1025, secure: false,
      ignoreTLS: true, auth: undefined
    });
  });
});
