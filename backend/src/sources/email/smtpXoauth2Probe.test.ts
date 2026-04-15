import { buildSmtpXoauth2Token } from "@/sources/email/smtpXoauth2Probe.js";

describe("buildSmtpXoauth2Token", () => {
  it("builds the expected xoauth2 auth payload", () => {
    const token = buildSmtpXoauth2Token("ap@example.com", "access-token-1");
    const decoded = Buffer.from(token, "base64").toString("utf8");
    expect(decoded).toBe("user=ap@example.com\x01auth=Bearer access-token-1\x01\x01");
  });
});
