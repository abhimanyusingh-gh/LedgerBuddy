import { Router } from "express";
import type { IngestionService } from "../services/ingestionService.js";
import { getCorrelationId, logger, runWithLogContext } from "../utils/logger.js";

type IngestionJobState = "idle" | "running" | "completed" | "failed";

interface IngestionJobStatus {
  state: IngestionJobState;
  running: boolean;
  totalFiles: number;
  processedFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  correlationId?: string;
  lastUpdatedAt: string;
}

let currentJobStatus: IngestionJobStatus = buildIdleStatus();

export function createJobsRouter(ingestionService: IngestionService) {
  const router = Router();

  router.get("/jobs/ingest/status", (_req, res) => {
    res.json(currentJobStatus);
  });

  router.post("/jobs/ingest", async (_req, res, next) => {
    if (currentJobStatus.running) {
      res.status(202).json(currentJobStatus);
      return;
    }

    try {
      const startedAt = new Date().toISOString();
      const correlationId = getCorrelationId();
      currentJobStatus = {
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
      logger.info("ingestion.job.start", { correlationId: correlationId ?? null });

      const runJob = () =>
        ingestionService.runOnce({
          onProgress: async (progress) => {
            currentJobStatus = {
              ...currentJobStatus,
              ...progress,
              state: progress.running ? "running" : currentJobStatus.state,
              running: progress.running
            };
          }
        });

      void (correlationId ? runWithLogContext(correlationId, runJob) : runJob())
        .then((summary) => {
          const completedAt = new Date().toISOString();
          currentJobStatus = {
            ...currentJobStatus,
            ...summary,
            processedFiles: Math.max(currentJobStatus.processedFiles, summary.totalFiles),
            state: "completed",
            running: false,
            completedAt,
            error: undefined,
            lastUpdatedAt: completedAt
          };
          logger.info("ingestion.job.complete", { ...summary, correlationId: correlationId ?? null });
        })
        .catch((error) => {
          const completedAt = new Date().toISOString();
          currentJobStatus = {
            ...currentJobStatus,
            state: "failed",
            running: false,
            completedAt,
            error: error instanceof Error ? error.message : String(error),
            lastUpdatedAt: completedAt
          };
          logger.error("ingestion.job.failed", {
            error: error instanceof Error ? error.message : String(error),
            correlationId: correlationId ?? null
          });
        });

      res.status(202).json(currentJobStatus);
    } catch (error) {
      next(error);
    }
  });

  return router;
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
    lastUpdatedAt: new Date().toISOString()
  };
}
