import { env } from "@/config/env.js";
import type { InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";
import { MailboxNotificationEventModel } from "@/models/integration/MailboxNotificationEvent.js";
import { UserModel } from "@/models/core/User.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { logger } from "@/utils/logger.js";

interface ReauthNotificationInput {
  tenantId: string;
  userId: string;
  provider: "gmail";
  emailAddress: string;
  reason: string;
}

export class MailboxNotificationService {
  constructor(private readonly emailSender: InviteEmailSenderBoundary) {}

  async notifyNeedsReauth(input: ReauthNotificationInput): Promise<void> {
    const event = await MailboxNotificationEventModel.create({
      userId: input.userId,
      provider: input.provider,
      emailAddress: input.emailAddress,
      eventType: "MAILBOX_NEEDS_REAUTH",
      reason: input.reason,
      delivered: false
    });

    const recipient = await this.resolveRecipient(input.userId, input.tenantId);
    if (!recipient) {
      logger.warn("mailbox.notification.no_recipient", {
        userId: input.userId,
        tenantId: input.tenantId,
        provider: input.provider
      });
      return;
    }

    const from = env.INVITE_FROM;
    if (!from.trim()) {
      logger.warn("mailbox.notification.no_sender_configured", {
        userId: input.userId,
        provider: input.provider
      });
      return;
    }

    await this.emailSender.send({
      from,
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

  private async resolveRecipient(userId: string, tenantId: string): Promise<string | null> {
    const creator = await UserModel.findById(userId).select({ email: 1 }).lean();
    if (creator?.email) {
      return creator.email;
    }

    const adminRole = await TenantUserRoleModel.findOne({
      tenantId,
      role: "TENANT_ADMIN"
    }).select({ userId: 1 }).lean();
    if (!adminRole) {
      return null;
    }

    const admin = await UserModel.findById(adminRole.userId).select({ email: 1 }).lean();
    return admin?.email ?? null;
  }
}
