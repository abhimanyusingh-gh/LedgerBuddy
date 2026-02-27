import { Schema, model, type InferSchemaType } from "mongoose";
import { MailboxConnectionStates, MailboxProviders } from "../types/mailbox.js";

const mailboxConnectionSchema = new Schema(
  {
    userId: { type: String, required: true },
    provider: { type: String, enum: MailboxProviders, required: true },
    emailAddress: { type: String, required: true },
    refreshTokenEncrypted: { type: String, required: true },
    connectionState: { type: String, enum: MailboxConnectionStates, required: true, default: "CONNECTED" },
    lastErrorReason: { type: String },
    lastSyncedAt: { type: Date },
    reauthNotifiedAt: { type: Date }
  },
  {
    timestamps: true
  }
);

mailboxConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

type MailboxConnection = InferSchemaType<typeof mailboxConnectionSchema>;

export const MailboxConnectionModel = model<MailboxConnection>("MailboxConnection", mailboxConnectionSchema);
