import nodemailer from "nodemailer";
import type { InviteEmailPayload, InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";

interface SmtpInviteEmailSenderProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  username?: string;
  password?: string;
}

export class SmtpInviteEmailSenderProvider implements InviteEmailSenderBoundary {
  private readonly transport;

  constructor(config: SmtpInviteEmailSenderProviderConfig) {
    const username = config.username?.trim() ?? "";
    const password = config.password?.trim() ?? "";
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ignoreTLS: !config.secure,
      auth: username && password ? { user: username, pass: password } : undefined
    });
  }

  async send(payload: InviteEmailPayload): Promise<void> {
    await this.transport.sendMail(payload);
  }
}
