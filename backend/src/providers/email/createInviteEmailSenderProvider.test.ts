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

const smtpCtorMock = jest.fn((_config: unknown) => ({ provider: "smtp" }));
const sendGridCtorMock = jest.fn((_config: unknown) => ({ provider: "sendgrid" }));

jest.mock("../../config/env.js", () => ({
  env: mockEnv
}));

jest.mock("./SmtpInviteEmailSenderProvider.js", () => ({
  SmtpInviteEmailSenderProvider: jest.fn().mockImplementation((config: unknown) => smtpCtorMock(config))
}));

jest.mock("./SendGridInviteEmailSenderProvider.js", () => ({
  SendGridInviteEmailSenderProvider: jest.fn().mockImplementation((config: unknown) => sendGridCtorMock(config))
}));

import { createInviteEmailSenderProvider } from "./createInviteEmailSenderProvider.ts";

describe("createInviteEmailSenderProvider", () => {
  beforeEach(() => {
    mockEnv.INVITE_EMAIL_PROVIDER = "smtp";
    mockEnv.INVITE_SENDGRID_API_KEY = "";
    smtpCtorMock.mockClear();
    sendGridCtorMock.mockClear();
  });

  it("creates SMTP invite sender when provider is smtp", () => {
    const provider = createInviteEmailSenderProvider();

    expect(provider).toEqual({ provider: "smtp" });
    expect(smtpCtorMock).toHaveBeenCalledWith({
      host: "mailhog",
      port: 1025,
      secure: false,
      username: "",
      password: ""
    });
    expect(sendGridCtorMock).not.toHaveBeenCalled();
  });

  it("creates SendGrid invite sender when provider is sendgrid", () => {
    mockEnv.INVITE_EMAIL_PROVIDER = "sendgrid";
    mockEnv.INVITE_SENDGRID_API_KEY = "sg-token";

    const provider = createInviteEmailSenderProvider();

    expect(provider).toEqual({ provider: "sendgrid" });
    expect(sendGridCtorMock).toHaveBeenCalledWith({
      apiKey: "sg-token",
      endpoint: "https://api.sendgrid.com/v3/mail/send",
      timeoutMs: 15000
    });
    expect(smtpCtorMock).not.toHaveBeenCalled();
  });

  it("throws when sendgrid provider is selected without api key", () => {
    mockEnv.INVITE_EMAIL_PROVIDER = "sendgrid";

    expect(() => createInviteEmailSenderProvider()).toThrow(
      "INVITE_SENDGRID_API_KEY is required when INVITE_EMAIL_PROVIDER=sendgrid."
    );
  });
});
