const axiosPostMock = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    post: (...args: unknown[]) => axiosPostMock(...args)
  }
}));

import { SendGridInviteEmailSenderProvider } from "./SendGridInviteEmailSenderProvider.ts";

describe("SendGridInviteEmailSenderProvider", () => {
  beforeEach(() => {
    axiosPostMock.mockReset();
    axiosPostMock.mockResolvedValue({ status: 202 });
  });

  it("sends invite email through SendGrid API", async () => {
    const provider = new SendGridInviteEmailSenderProvider({
      apiKey: "sg-token",
      endpoint: "https://api.sendgrid.com/v3/mail/send/",
      timeoutMs: 5000
    });

    await provider.send({
      from: "from@example.com",
      to: "to@example.com",
      subject: "Invite",
      text: "hello"
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
