import type { Response, Request } from "express";
import { SSE_HEARTBEAT_INTERVAL_MS } from "@/constants.js";
import { logger } from "@/utils/logger.js";
import { getRedisClient } from "@/db/redis.js";

export type BankParseStage = "ocr" | "text-extraction" | "slm-chunk" | "validation";

export interface BankParseProgressEvent {
  type: "start" | "progress" | "complete" | "error";
  fileName?: string;
  statementId?: string;
  stage?: BankParseStage;
  chunk?: number;
  totalChunks?: number;
  transactionsSoFar?: number;
  transactionCount?: number;
  warnings?: string[];
  message?: string;
}

const LAST_EVENT_TTL_SECONDS = 3600;

export class BankStatementParseProgress {
  private readonly subscribers = new Map<string, Set<Response>>();
  private readonly localLastEvent = new Map<string, BankParseProgressEvent>();

  broadcast(tenantId: string, event: BankParseProgressEvent): void {
    this.localLastEvent.set(tenantId, event);
    void getRedisClient().setex(`bankparse:lastEvent:${tenantId}`, LAST_EVENT_TTL_SECONDS, JSON.stringify(event)).catch(() => {});
    const subs = this.subscribers.get(tenantId);
    if (!subs || subs.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
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

    const current = this.localLastEvent.get(tenantId);
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
        logger.info("bank.sse.heartbeat.write.failed", {
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

  clearEvent(tenantId: string): void {
    this.localLastEvent.delete(tenantId);
    void getRedisClient().del(`bankparse:lastEvent:${tenantId}`).catch(() => {});
  }
}
