import { AuditLogModel, type AuditEntityType } from "@/models/core/AuditLog.js";
import { AuditLogDeadLetterModel } from "@/models/core/AuditLogDeadLetter.js";
import { logger } from "@/utils/logger.js";

interface AuditLogPayload {
  tenantId: string;
  entityType: AuditEntityType;
  entityId: string;
  action: string;
  previousValue?: unknown;
  newValue?: unknown;
  userId: string;
  userEmail?: string | null;
}

const RETRY_BACKOFF_MS = [
  60 * 60 * 1000,
  2 * 60 * 60 * 1000,
  4 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000
] as const;

export const AUDIT_RETRY_MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;

interface AuditLogServiceOptions {
  now?: () => Date;
}

export class AuditLogService {
  private readonly now: () => Date;

  constructor(options: AuditLogServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  record(payload: AuditLogPayload): Promise<void> {
    const doc = {
      tenantId: payload.tenantId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      action: payload.action,
      previousValue: payload.previousValue ?? null,
      newValue: payload.newValue ?? null,
      userId: payload.userId,
      userEmail: payload.userEmail ?? null,
      timestamp: this.now()
    };

    return AuditLogModel.create(doc)
      .then(() => undefined)
      .catch(async (error) => {
        await this.handleWriteFailure(doc, error);
      });
  }

  async retryDeadLetters(): Promise<{ retried: number; succeeded: number; givenUp: number }> {
    const now = this.now();
    const due = await AuditLogDeadLetterModel.find({
      givenUp: false,
      nextAttemptAt: { $lte: now }
    }).lean();

    let succeeded = 0;
    let givenUp = 0;

    for (const entry of due) {
      try {
        await AuditLogModel.create(entry.payload);
        await AuditLogDeadLetterModel.deleteOne({ _id: entry._id });
        succeeded += 1;
      } catch (error) {
        const nextAttempts = (entry.attempts ?? 0) + 1;
        if (nextAttempts >= AUDIT_RETRY_MAX_ATTEMPTS) {
          await AuditLogDeadLetterModel.updateOne(
            { _id: entry._id },
            {
              $set: {
                attempts: nextAttempts,
                lastError: serializeError(error),
                givenUp: true
              }
            }
          );
          logger.error("audit_log.dead_letter.given_up", {
            id: String(entry._id),
            attempts: nextAttempts,
            error: serializeError(error)
          });
          givenUp += 1;
        } else {
          const backoffMs = RETRY_BACKOFF_MS[nextAttempts] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
          await AuditLogDeadLetterModel.updateOne(
            { _id: entry._id },
            {
              $set: {
                attempts: nextAttempts,
                lastError: serializeError(error),
                nextAttemptAt: new Date(now.getTime() + backoffMs)
              }
            }
          );
        }
      }
    }

    return { retried: due.length, succeeded, givenUp };
  }

  private async handleWriteFailure(doc: Record<string, unknown>, error: unknown): Promise<void> {
    logger.error("audit_log_write_failed", {
      tenantId: String(doc.tenantId),
      entityType: String(doc.entityType),
      entityId: String(doc.entityId),
      action: String(doc.action),
      error: serializeError(error)
    });

    try {
      const firstBackoffMs = RETRY_BACKOFF_MS[0];
      await AuditLogDeadLetterModel.create({
        payload: doc,
        attempts: 0,
        nextAttemptAt: new Date(this.now().getTime() + firstBackoffMs),
        lastError: serializeError(error)
      });
    } catch (deadLetterError) {
      logger.error("audit_log.dead_letter.write_failed", {
        error: serializeError(deadLetterError)
      });
    }
  }
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export { RETRY_BACKOFF_MS };
