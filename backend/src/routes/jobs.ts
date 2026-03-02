import { Router } from "express";
import type { IngestionService } from "../services/ingestionService.js";
import type { EmailSimulationService } from "../services/emailSimulationService.js";
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

const currentJobStatusByTenant = new Map<string, IngestionJobStatus>();

export function createJobsRouter(ingestionService: IngestionService, emailSimulationService?: EmailSimulationService) {
  const router = Router();

  router.get("/jobs/ingest/status", (request, response) => {
    const context = request.authContext;
    if (!context) {
      response.status(401).json({ message: "Authentication required." });
      return;
    }

    response.json(getCurrentStatus(context.tenantId));
  });

  router.post("/jobs/ingest", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }
      response.status(202).json(startIngestionJob(ingestionService, context.tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/ingest/email-simulate", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }

      const current = getCurrentStatus(context.tenantId);
      if (current.running) {
        response.status(202).json(current);
        return;
      }

      if (!emailSimulationService) {
        response.status(400).json({
          message: "Email simulation service is unavailable."
        });
        return;
      }

      const simulation = await emailSimulationService.seedSampleEmails();
      logger.info("ingestion.email.simulation.seeded", {
        emailsSeeded: simulation.emailsSeeded,
        attachmentsSeeded: simulation.attachmentsSeeded,
        tenantId: context.tenantId
      });
      const status = startIngestionJob(ingestionService, context.tenantId);
      response.status(202).json({
        ...status,
        emailSimulation: simulation
      });
    } catch (error) {
      if (error instanceof Error) {
        response.status(400).json({ message: error.message });
        return;
      }
      next(error);
    }
  });

  return router;
}

function getCurrentStatus(tenantId: string): IngestionJobStatus {
  return currentJobStatusByTenant.get(tenantId) ?? buildIdleStatus();
}

function setCurrentStatus(tenantId: string, status: IngestionJobStatus): void {
  currentJobStatusByTenant.set(tenantId, status);
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

function startIngestionJob(ingestionService: IngestionService, tenantId: string): IngestionJobStatus {
  const existing = getCurrentStatus(tenantId);
  if (existing.running) {
    return existing;
  }

  const startedAt = new Date().toISOString();
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
  setCurrentStatus(tenantId, runningStatus);
  logger.info("ingestion.job.start", { correlationId: correlationId ?? null, tenantId });

  const runJob = () =>
    ingestionService.runOnce({
      tenantId,
      onProgress: async (progress) => {
        const current = getCurrentStatus(tenantId);
        setCurrentStatus(tenantId, {
          ...current,
          ...progress,
          state: progress.running ? "running" : current.state,
          running: progress.running
        });
      }
    });

  void (correlationId ? runWithLogContext(correlationId, runJob) : runJob())
    .then((summary) => {
      const completedAt = new Date().toISOString();
      const current = getCurrentStatus(tenantId);
      const nextStatus: IngestionJobStatus = {
        ...current,
        ...summary,
        processedFiles: Math.max(current.processedFiles, summary.totalFiles),
        state: "completed",
        running: false,
        completedAt,
        error: undefined,
        lastUpdatedAt: completedAt
      };
      setCurrentStatus(tenantId, nextStatus);
      logger.info("ingestion.job.complete", { ...summary, correlationId: correlationId ?? null, tenantId });
    })
    .catch((error) => {
      const completedAt = new Date().toISOString();
      const current = getCurrentStatus(tenantId);
      const nextStatus: IngestionJobStatus = {
        ...current,
        state: "failed",
        running: false,
        completedAt,
        error: error instanceof Error ? error.message : String(error),
        lastUpdatedAt: completedAt
      };
      setCurrentStatus(tenantId, nextStatus);
      logger.error("ingestion.job.failed", {
        error: error instanceof Error ? error.message : String(error),
        correlationId: correlationId ?? null,
        tenantId
      });
    });

  return runningStatus;
}
