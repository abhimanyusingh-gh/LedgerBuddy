import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { IngestedFile, IngestionSource } from "../core/interfaces/IngestionSource.js";
import { logger } from "../utils/logger.js";
import { isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "../utils/mime.js";
import type { WorkloadTier } from "../types/tenant.js";

interface EmailSourceConfig {
  key: string;
  tenantId?: string;
  workloadTier?: WorkloadTier;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
  fromFilter?: string;
}

export class EmailIngestionSource implements IngestionSource {
  readonly type = "email";

  readonly key: string;
  readonly tenantId: string;
  readonly workloadTier: WorkloadTier;

  private readonly config: EmailSourceConfig;

  constructor(config: EmailSourceConfig) {
    this.config = config;
    this.key = config.key;
    this.tenantId = config.tenantId ?? "default";
    this.workloadTier = config.workloadTier ?? "standard";
  }

  async fetchNewFiles(lastCheckpoint: string | null): Promise<IngestedFile[]> {
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: {
        user: this.config.username,
        pass: this.config.password
      }
    });

    const files: IngestedFile[] = [];
    const minUid = lastCheckpoint ? Number(lastCheckpoint) : 0;

    await client.connect();

    try {
      await client.mailboxOpen(this.config.mailbox);

      for await (const message of client.fetch("1:*", {
        uid: true,
        source: true,
        envelope: true,
        internalDate: true
      })) {
        if (!message.uid || message.uid <= minUid || !message.source) {
          continue;
        }

        const parsedMail = await simpleParser(message.source);
        const from = parsedMail.from?.text ?? "";
        if (this.config.fromFilter && !from.toLowerCase().includes(this.config.fromFilter.toLowerCase())) {
          continue;
        }

        const attachments = parsedMail.attachments ?? [];
        for (const attachment of attachments) {
          const mimeType = normalizeInvoiceMimeType(attachment.contentType ?? "");
          if (!isSupportedInvoiceMimeType(mimeType)) {
            continue;
          }

          files.push({
            tenantId: this.tenantId,
            workloadTier: this.workloadTier,
            sourceKey: this.key,
            sourceType: this.type,
            sourceDocumentId: String(message.uid),
            attachmentName: attachment.filename ?? `attachment-${message.uid}`,
            mimeType,
            receivedAt: message.internalDate ?? parsedMail.date ?? new Date(),
            buffer: attachment.content,
            checkpointValue: String(message.uid),
            metadata: {
              messageId: parsedMail.messageId ?? "",
              subject: parsedMail.subject ?? "",
              from
            }
          });
        }
      }
    } catch (error) {
      logger.error("Failed reading from email source", {
        sourceKey: this.key,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    } finally {
      await client.logout().catch(() => undefined);
    }

    files.sort((a, b) => Number(a.checkpointValue) - Number(b.checkpointValue));
    return files;
  }
}
