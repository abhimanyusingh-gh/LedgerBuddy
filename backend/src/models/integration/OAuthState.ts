import { Schema, model, type InferSchemaType } from "mongoose";
import { MailboxProviders } from "@/types/mailbox.js";

const oauthStateSchema = new Schema(
  {
    state: { type: String, required: true, unique: true },
    userId: { type: String, required: true },
    tenantId: { type: String },
    provider: { type: String, enum: MailboxProviders, required: true },
    codeVerifier: { type: String, required: true },
    expiresAt: { type: Date, required: true }
  },
  {
    timestamps: true
  }
);

oauthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

type OAuthState = InferSchemaType<typeof oauthStateSchema>;

export const OAuthStateModel = model<OAuthState>("OAuthState", oauthStateSchema);
