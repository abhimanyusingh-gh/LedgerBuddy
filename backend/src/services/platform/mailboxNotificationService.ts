import { env } from "@/config/env.js";
import type { InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";
import { MailboxNotificationEventModel } from "@/models/integration/MailboxNotificationEvent.js";
import { UserModel } from "@/models/core/User.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { logger } from "@/utils/logger.js";

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 3;

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
    const dedupCutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    const existing = await MailboxNotificationEventModel.findOne({
      emailAddress: input.emailAddress,
      eventType: "MAILBOX_NEEDS_REAUTH",
      createdAt: { $gte: dedupCutoff },
      $or: [{ delivered: true }, { deliveryFailed: false }]
    }).lean();

    if (existing) {
      await MailboxNotificationEventModel.create({
        userId: input.userId,
        provider: input.provider,
        emailAddress: input.emailAddress,
        eventType: "MAILBOX_NEEDS_REAUTH",
        reason: input.reason,
        delivered: false,
        deliveryFailed: true,
        skippedReason: "duplicate_within_24h"
      });
      logger.info("mailbox.notification.dedup_skipped", {
        emailAddress: input.emailAddress,
        eventType: "MAILBOX_NEEDS_REAUTH"
      });
      return;
    }

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

    const ccRecipients = await this.resolveCcRecipients(input.tenantId, input.userId);

    try {
      await this.emailSender.send({
        from,
        to: recipient,
        ...(ccRecipients.length > 0 ? { cc: ccRecipients } : {}),
        subject: "LedgerBuddy mailbox requires reconnection",
        text: [
          "We lost access to your Gmail mailbox.",
          "",
          `Account: ${input.emailAddress}`,
          `Reason: ${input.reason}`,
          "",
          "Please reconnect the mailbox from the LedgerBuddy UI."
        ].join("\n")
      });

      event.delivered = true;
      event.recipient = recipient;
      event.ccRecipients = ccRecipients;
      await event.save();
      logger.info("mailbox.notification.sent", {
        userId: input.userId,
        provider: input.provider,
        recipient
      });
    } catch (error) {
      event.failureReason = error instanceof Error ? error.message : String(error);
      event.recipient = recipient;
      event.ccRecipients = ccRecipients;
      await event.save();
      logger.warn("mailbox.notification.delivery_failed", {
        userId: input.userId,
        provider: input.provider,
        recipient,
        error: event.failureReason
      });
    }
  }

  async retryFailedNotifications(): Promise<void> {
    const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS);
    const failedEvents = await MailboxNotificationEventModel.find({
      delivered: false,
      deliveryFailed: false,
      skippedReason: null,
      retryCount: { $lt: MAX_RETRY_ATTEMPTS },
      createdAt: { $gte: cutoff }
    });

    for (const event of failedEvents) {
      const recipient = event.recipient;
      if (!recipient) {
        event.deliveryFailed = true;
        event.failureReason = "no_recipient";
        await event.save();
        continue;
      }

      const from = env.INVITE_FROM;
      if (!from.trim()) {
        continue;
      }

      try {
        await this.emailSender.send({
          from,
          to: recipient,
          ...(event.ccRecipients.length > 0 ? { cc: event.ccRecipients } : {}),
          subject: "LedgerBuddy mailbox requires reconnection",
          text: [
            "We lost access to your Gmail mailbox.",
            "",
            `Account: ${event.emailAddress}`,
            `Reason: ${event.reason}`,
            "",
            "Please reconnect the mailbox from the LedgerBuddy UI."
          ].join("\n")
        });

        event.delivered = true;
        event.retryCount += 1;
        await event.save();
        logger.info("mailbox.notification.retry_succeeded", {
          eventId: String(event._id),
          retryCount: event.retryCount
        });
      } catch (error) {
        event.retryCount += 1;
        event.failureReason = error instanceof Error ? error.message : String(error);

        if (event.retryCount >= MAX_RETRY_ATTEMPTS) {
          event.deliveryFailed = true;
        }
        await event.save();
        logger.info("mailbox.notification.retry_failed", {
          eventId: String(event._id),
          retryCount: event.retryCount,
          gaveUp: event.retryCount >= MAX_RETRY_ATTEMPTS
        });
      }
    }
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

  private async resolveCcRecipients(tenantId: string, excludeUserId: string): Promise<string[]> {
    const roles = await TenantUserRoleModel.find({
      tenantId,
      "capabilities.canManageConnections": true,
      userId: { $ne: excludeUserId }
    }).select({ userId: 1 }).lean();

    if (roles.length === 0) return [];

    const userIds = roles.map((r) => r.userId);
    const users = await UserModel.find({ _id: { $in: userIds } }).select({ email: 1 }).lean();
    return users.map((u) => u.email).filter(Boolean);
  }
}
