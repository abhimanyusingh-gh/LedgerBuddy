import axios from "axios";
import type { InviteEmailPayload, InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";

interface SendGridInviteEmailSenderProviderConfig {
  apiKey: string;
  endpoint: string;
  timeoutMs: number;
}

export class SendGridInviteEmailSenderProvider implements InviteEmailSenderBoundary {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(config: SendGridInviteEmailSenderProviderConfig) {
    this.apiKey = config.apiKey.trim();
    this.endpoint = config.endpoint;
    this.timeoutMs = config.timeoutMs;
  }

  async send(payload: InviteEmailPayload): Promise<void> {
    await axios.post(
      this.endpoint,
      {
        personalizations: [{
          to: [{ email: payload.to }],
          ...(payload.cc?.length ? { cc: payload.cc.map((email) => ({ email })) } : {})
        }],
        from: { email: payload.from },
        subject: payload.subject,
        content: [
          { type: "text/plain", value: payload.text },
          ...(payload.html ? [{ type: "text/html", value: payload.html }] : [])
        ]
      },
      {
        timeout: this.timeoutMs,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );
  }
}
