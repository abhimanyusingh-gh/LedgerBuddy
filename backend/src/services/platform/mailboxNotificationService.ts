import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { MailboxNotificationEventModel } from "../models/MailboxNotificationEvent.js";
import { logger } from "../utils/logger.js";

interface ReauthNotificationInput {
  userId: string;
  provider: "gmail";
  emailAddress: string;
  reason: string;
}

export class MailboxNotificationService {
  async notifyNeedsReauth(input: ReauthNotificationInput): Promise<void> {
    const event = await MailboxNotificationEventModel.create({
      userId: input.userId,
      provider: input.provider,
      emailAddress: input.emailAddress,
      eventType: "MAILBOX_NEEDS_REAUTH",
      reason: input.reason,
      delivered: false
    });

    const recipient = env.MAILBOX_ALERT_TO.trim() || input.emailAddress;
    if (!env.MAILBOX_ALERT_SMTP_HOST.trim() || !env.MAILBOX_ALERT_FROM.trim() || !recipient) {
      logger.warn("mailbox.notification.smtp_not_configured", {
        userId: input.userId,
        provider: input.provider,
        recipient
      });
      return;
    }

    const transport = nodemailer.createTransport({
      host: env.MAILBOX_ALERT_SMTP_HOST,
      port: env.MAILBOX_ALERT_SMTP_PORT,
      secure: env.MAILBOX_ALERT_SMTP_SECURE,
      auth:
        env.MAILBOX_ALERT_SMTP_USERNAME.trim() && env.MAILBOX_ALERT_SMTP_PASSWORD.trim()
          ? {
              user: env.MAILBOX_ALERT_SMTP_USERNAME,
              pass: env.MAILBOX_ALERT_SMTP_PASSWORD
            }
          : undefined
    });

    await transport.sendMail({
      from: env.MAILBOX_ALERT_FROM,
      to: recipient,
      subject: "BillForge mailbox requires reconnection",
      text: [
        "We lost access to your Gmail mailbox.",
        "",
        `Account: ${input.emailAddress}`,
        `Reason: ${input.reason}`,
        "",
        "Please reconnect the mailbox from the BillForge UI."
      ].join("\n")
    });

    event.delivered = true;
    await event.save();
    logger.info("mailbox.notification.sent", {
      userId: input.userId,
      provider: input.provider,
      recipient
    });
  }
}
