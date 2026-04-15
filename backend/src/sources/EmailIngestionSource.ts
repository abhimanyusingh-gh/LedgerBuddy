import type { EmailIngestionBoundary } from "@/core/boundaries/EmailIngestionBoundary.js";
import type { IngestedFile, IngestionSource } from "@/core/interfaces/IngestionSource.js";
import { GmailImapIngestionProvider } from "@/sources/email/GmailImapIngestionProvider.js";
import { MailhogOAuthIngestionProvider } from "@/sources/email/MailhogOAuthIngestionProvider.js";
import type { EmailSourceConfig } from "@/sources/email/types.js";

export type { EmailSourceConfig } from "@/sources/email/types.js";

export class EmailIngestionSource implements IngestionSource {
  readonly type = "email";
  readonly key: string;
  readonly tenantId: string;
  readonly workloadTier: "standard" | "heavy";

  private readonly boundary: EmailIngestionBoundary;

  constructor(private readonly config: EmailSourceConfig) {
    assertSecureGmailConfig(config);
    this.key = config.key;
    this.tenantId = config.tenantId ?? "default";
    this.workloadTier = config.workloadTier ?? "standard";
    this.boundary =
      config.transport === "mailhog_oauth" ? new MailhogOAuthIngestionProvider(config) : new GmailImapIngestionProvider(config);
  }

  fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    return this.boundary.fetchNewFiles(lastCheckpoint);
  }
}

function assertSecureGmailConfig(config: EmailSourceConfig): void {
  if (config.transport !== "imap") {
    return;
  }
  if (config.host.trim().toLowerCase() !== "imap.gmail.com") {
    return;
  }
  if (!config.secure) {
    throw new Error("Gmail IMAP requires TLS. Set EMAIL_SECURE=true.");
  }
  if (config.port !== 993) {
    throw new Error("Gmail IMAP requires port 993.");
  }
}
