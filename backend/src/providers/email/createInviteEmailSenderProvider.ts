import { env } from "@/config/env.js";
import type { InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";
import { SendGridInviteEmailSenderProvider } from "@/providers/email/SendGridInviteEmailSenderProvider.js";
import { SmtpInviteEmailSenderProvider } from "@/providers/email/SmtpInviteEmailSenderProvider.js";

export function createInviteEmailSenderProvider(): InviteEmailSenderBoundary {
  if (env.INVITE_EMAIL_PROVIDER === "smtp") {
    return new SmtpInviteEmailSenderProvider({
      host: env.INVITE_SMTP_HOST,
      port: env.INVITE_SMTP_PORT,
      secure: env.INVITE_SMTP_SECURE,
      username: env.INVITE_SMTP_USERNAME,
      password: env.INVITE_SMTP_PASSWORD
    });
  }

  const apiKey = env.INVITE_SENDGRID_API_KEY.trim();
  if (!apiKey) {
    throw new Error("INVITE_SENDGRID_API_KEY is required when INVITE_EMAIL_PROVIDER=sendgrid.");
  }

  return new SendGridInviteEmailSenderProvider({
    apiKey,
    endpoint: env.INVITE_SENDGRID_ENDPOINT,
    timeoutMs: env.INVITE_SENDGRID_TIMEOUT_MS
  });
}
