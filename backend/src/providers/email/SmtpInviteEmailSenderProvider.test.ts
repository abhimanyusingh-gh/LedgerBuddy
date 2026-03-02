const sendMailMock = jest.fn();
const createTransportMock = jest.fn((_config: unknown) => ({
  sendMail: sendMailMock
}));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: {
    createTransport: (config: unknown) => createTransportMock(config)
  }
}));

import { SmtpInviteEmailSenderProvider } from "./SmtpInviteEmailSenderProvider.ts";

describe("SmtpInviteEmailSenderProvider", () => {
  beforeEach(() => {
    createTransportMock.mockClear();
    sendMailMock.mockReset();
    sendMailMock.mockResolvedValue(undefined);
  });

  it("creates SMTP transport with auth when credentials are provided", async () => {
    const provider = new SmtpInviteEmailSenderProvider({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      username: "user",
      password: "pass"
    });

    await provider.send({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Invite",
      text: "hello"
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      ignoreTLS: false,
      auth: {
        user: "user",
        pass: "pass"
      }
    });
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Invite",
      text: "hello"
    });
  });

  it("creates SMTP transport without auth when credentials are missing", () => {
    new SmtpInviteEmailSenderProvider({
      host: "smtp.example.com",
      port: 1025,
      secure: false
    });

    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 1025,
      secure: false,
      ignoreTLS: true,
      auth: undefined
    });
  });
});
