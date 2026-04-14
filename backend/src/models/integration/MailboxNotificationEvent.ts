import { Schema, model, type InferSchemaType } from "mongoose";
import { MailboxProviders } from "@/types/mailbox.js";

const mailboxNotificationEventSchema = new Schema(
  {
    userId: { type: String, required: true },
    provider: { type: String, enum: MailboxProviders, required: true },
    emailAddress: { type: String, required: true },
    eventType: { type: String, required: true },
    reason: { type: String, required: true },
    delivered: { type: Boolean, required: true, default: false }
  },
  {
    timestamps: true
  }
);

mailboxNotificationEventSchema.index({ userId: 1, provider: 1, eventType: 1, createdAt: -1 });

type MailboxNotificationEvent = InferSchemaType<typeof mailboxNotificationEventSchema>;

export const MailboxNotificationEventModel = model<MailboxNotificationEvent>(
  "MailboxNotificationEvent",
  mailboxNotificationEventSchema
);
