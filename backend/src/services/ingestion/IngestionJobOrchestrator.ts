import type { Response, Request } from "express";
import type { IngestionService } from "@/services/ingestion/ingestionService.js";
import { getCorrelationId, logger, runWithLogContext } from "@/utils/logger.js";
import { SSE_HEARTBEAT_INTERVAL_MS, RERUN_MAX_COUNT } from "@/constants.js";
import { getRedisClient } from "@/db/redis.js";

type IngestionJobState = "idle" | "running" | "completed" | "failed" | "paused";

interface IngestionJobStatus {
  state: IngestionJobState;
  running: boolean;
  totalFiles: number;
  processedFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  correlationId?: string;
  lastUpdatedAt: Date;
  systemAlert?: string;
}

const STATUS_TTL_SECONDS = 86400;
const PENDING_RERUN_TTL_SECONDS = 3600;

export class IngestionJobOrchestrator {
  private readonly localStatus = new Map<string, IngestionJobStatus>();
  private readonly localPendingRerun = new Map<string, boolean>();
  private readonly subscribers = new Map<string, Set<Response>>();

  getCurrentStatus(tenantId: string): IngestionJobStatus {
    return this.localStatus.get(tenantId) ?? buildIdleStatus();
  }

  setCurrentStatus(tenantId: string, status: IngestionJobStatus): void {
    this.localStatus.set(tenantId, status);
    void getRedisClient().setex(`ingestion:status:${tenantId}`, STATUS_TTL_SECONDS, JSON.stringify(status)).catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
  }

  setPendingRerun(tenantId: string): void {
    this.localPendingRerun.set(tenantId, true);
    void getRedisClient().setex(`ingestion:pendingRerun:${tenantId}`, PENDING_RERUN_TTL_SECONDS, "1").catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
  }

  private consumePendingRerun(tenantId: string): boolean {
    const had = this.localPendingRerun.get(tenantId) === true;
    this.localPendingRerun.delete(tenantId);
    void getRedisClient().del(`ingestion:pendingRerun:${tenantId}`).catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
    return had;
  }

  broadcastToSubscribers(tenantId: string, status: IngestionJobStatus): void {
    const subs = this.subscribers.get(tenantId);
    if (!subs || subs.size === 0) return;
    const payload = `data: ${JSON.stringify(status)}\n\n`;
    for (const client of subs) {
      client.write(payload);
    }
  }

  addSubscriber(tenantId: string, res: Response, req: Request): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write(":\n\n");

    const current = this.localStatus.get(tenantId);
    if (current) {
      res.write(`data: ${JSON.stringify(current)}\n\n`);
    }

    if (!this.subscribers.has(tenantId)) {
      this.subscribers.set(tenantId, new Set());
    }
    this.subscribers.get(tenantId)!.add(res);

    const heartbeat = setInterval(() => {
      try {
        const ok = res.write(":\n\n");
        if (!ok) {
          this.subscribers.get(tenantId)?.delete(res);
          clearInterval(heartbeat);
        }
      } catch (error) {
        logger.info("sse.heartbeat.write.failed", {
          tenantId,
          error: error instanceof Error ? error.message : String(error)
        });
        this.subscribers.get(tenantId)?.delete(res);
        clearInterval(heartbeat);
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.subscribers.get(tenantId)?.delete(res);
    });
  }

  startJob(ingestionService: IngestionService, tenantId: string, rerunCount = 0): IngestionJobStatus {
    const existing = this.getCurrentStatus(tenantId);
    if (existing.running) {
      this.setPendingRerun(tenantId);
      return existing;
    }

    const startedAt = new Date();
    const correlationId = getCorrelationId();
    const runningStatus: IngestionJobStatus = {
      state: "running",
      running: true,
      totalFiles: 0,
      processedFiles: 0,
      newInvoices: 0,
      duplicates: 0,
      failures: 0,
      startedAt,
      lastUpdatedAt: startedAt,
      ...(correlationId ? { correlationId } : {})
    };
    this.setCurrentStatus(tenantId, runningStatus);
    logger.info("ingestion.job.start", { correlationId: correlationId ?? null, tenantId });

    const runJob = () =>
      ingestionService.runOnce({
        tenantId,
        onProgress: async (progress) => {
          const current = this.getCurrentStatus(tenantId);
          const updated: IngestionJobStatus = {
            ...current,
            ...progress,
            state: progress.running ? "running" : current.state,
            running: progress.running
          };
          this.setCurrentStatus(tenantId, updated);
          this.broadcastToSubscribers(tenantId, updated);
          if (updated.systemAlert) {
            this.setCurrentStatus(tenantId, { ...updated, systemAlert: undefined });
          }
        }
      });

    void (correlationId ? runWithLogContext(correlationId, runJob) : runJob())
      .then((summary) => {
        const completedAt = new Date();
        const current = this.getCurrentStatus(tenantId);
        const finalState: IngestionJobState = summary.paused ? "paused" : "completed";
        const nextStatus: IngestionJobStatus = {
          ...current,
          ...summary,
          processedFiles: Math.max(current.processedFiles, summary.totalFiles),
          state: finalState,
          running: false,
          completedAt: summary.paused ? undefined : completedAt,
          error: undefined,
          lastUpdatedAt: completedAt
        };
        this.setCurrentStatus(tenantId, nextStatus);
        this.broadcastToSubscribers(tenantId, nextStatus);
        logger.info(summary.paused ? "ingestion.job.paused" : "ingestion.job.complete", {
          ...summary,
          correlationId: correlationId ?? null,
          tenantId
        });

        if (summary.paused) {
          this.localPendingRerun.delete(tenantId);
          void getRedisClient().del(`ingestion:pendingRerun:${tenantId}`).catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
          return;
        }

        if (this.consumePendingRerun(tenantId) && rerunCount < RERUN_MAX_COUNT) {
          this.startJob(ingestionService, tenantId, rerunCount + 1);
        }
      })
      .catch((error) => {
        const completedAt = new Date();
        const current = this.getCurrentStatus(tenantId);
        const nextStatus: IngestionJobStatus = {
          ...current,
          state: "failed",
          running: false,
          completedAt,
          error: error instanceof Error ? error.message : String(error),
          lastUpdatedAt: completedAt
        };
        this.setCurrentStatus(tenantId, nextStatus);
        this.broadcastToSubscribers(tenantId, nextStatus);
        this.localPendingRerun.delete(tenantId);
        void getRedisClient().del(`ingestion:pendingRerun:${tenantId}`).catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
        logger.error("ingestion.job.failed", {
          error: error instanceof Error ? error.message : String(error),
          correlationId: correlationId ?? null,
          tenantId
        });
      });

    return runningStatus;
  }

  pauseJob(ingestionService: IngestionService, tenantId: string): IngestionJobStatus {
    const current = this.getCurrentStatus(tenantId);
    if (!current.running) {
      return current;
    }
    ingestionService.requestPause();
    this.localPendingRerun.delete(tenantId);
    void getRedisClient().del(`ingestion:pendingRerun:${tenantId}`).catch((err) => logger.warn("redis.operation.failed", { error: String(err) }));
    const paused: IngestionJobStatus = { ...current, state: "paused" };
    this.setCurrentStatus(tenantId, paused);
    this.broadcastToSubscribers(tenantId, paused);
    return paused;
  }
}

function buildIdleStatus(): IngestionJobStatus {
  return {
    state: "idle",
    running: false,
    totalFiles: 0,
    processedFiles: 0,
    newInvoices: 0,
    duplicates: 0,
    failures: 0,
    lastUpdatedAt: new Date()
  };
}
