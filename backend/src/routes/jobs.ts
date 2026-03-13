import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { IngestionService } from "../services/ingestionService.js";
import type { EmailSimulationService } from "../services/emailSimulationService.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { InvoiceModel } from "../models/Invoice.js";
import { getCorrelationId, logger, runWithLogContext } from "../utils/logger.js";
import { requireAuth } from "../auth/requireAuth.js";

type IngestionJobState = "idle" | "running" | "completed" | "failed" | "paused";

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
const sseSubscribers = new Map<string, Set<import("express").Response>>();

function broadcastToSubscribers(tenantId: string, status: IngestionJobStatus): void {
  const subs = sseSubscribers.get(tenantId);
  if (!subs || subs.size === 0) return;
  const payload = `data: ${JSON.stringify(status)}\n\n`;
  for (const client of subs) {
    client.write(payload);
  }
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 50 } });

export function createJobsRouter(ingestionService: IngestionService, emailSimulationService?: EmailSimulationService, fileStore?: FileStore) {
  const router = Router();
  router.use(requireAuth);

  router.get("/jobs/ingest/status", (request, response) => {
    const context = request.authContext!;
    response.json(getCurrentStatus(context.tenantId));
  });

  router.get("/jobs/ingest/sse", (request, response) => {
    const context = request.authContext!;
    const tenantId = context.tenantId;

    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    });
    response.write(":\n\n");

    const current = currentJobStatusByTenant.get(tenantId);
    if (current) {
      response.write(`data: ${JSON.stringify(current)}\n\n`);
    }

    if (!sseSubscribers.has(tenantId)) {
      sseSubscribers.set(tenantId, new Set());
    }
    sseSubscribers.get(tenantId)!.add(response);
    request.on("close", () => {
      sseSubscribers.get(tenantId)?.delete(response);
    });
  });

  router.post("/jobs/ingest", async (request, response, next) => {
    try {
      const context = request.authContext!;
      response.status(202).json(startIngestionJob(ingestionService, context.tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/ingest/email-simulate", async (request, response, next) => {
    try {
      const context = request.authContext!;
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

  router.post("/jobs/upload", (request, response, next) => {
    const uploadMiddleware = upload.array("files", 50) as unknown as import("express").RequestHandler;
    uploadMiddleware(request, response, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        const userMessage = multerErrorMessage(error);
        response.status(400).json({ message: userMessage });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  }, async (request, response, next) => {
    try {
      const context = request.authContext!;
      if (!fileStore) {
        response.status(400).json({ message: "File storage is not configured." });
        return;
      }

      const files = request.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        response.status(400).json({ message: "No files provided." });
        return;
      }

      const uploaded: string[] = [];
      for (const file of files) {
        const fileId = randomBytes(12).toString("base64url");
        const ext = file.originalname.includes(".") ? file.originalname.slice(file.originalname.lastIndexOf(".")) : "";
        const systemName = `${fileId}${ext}`;
        const key = `uploads/${context.tenantId}/${systemName}`;
        const contentHash = createHash("sha256").update(file.buffer).digest("base64url");

        await fileStore.putObject({
          key,
          body: file.buffer,
          contentType: file.mimetype,
          metadata: { tenantId: context.tenantId, originalName: file.originalname }
        });

        try {
          await InvoiceModel.create({
            tenantId: context.tenantId,
            workloadTier: "standard",
            sourceType: "s3-upload",
            sourceKey: `s3-upload-${context.tenantId}`,
            sourceDocumentId: key,
            attachmentName: file.originalname,
            mimeType: file.mimetype,
            receivedAt: new Date(),
            status: "PENDING",
            contentHash,
            metadata: { uploadKey: key, systemFileName: systemName }
          });
        } catch {
          // duplicate sourceDocumentId — skip silently
        }

        uploaded.push(key);
      }

      response.status(201).json({ uploaded, count: uploaded.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/ingest/pause", (request, response) => {
    const context = request.authContext!;
    const current = getCurrentStatus(context.tenantId);
    if (!current.running) {
      response.json(current);
      return;
    }
    ingestionService.requestPause();
    const paused: IngestionJobStatus = { ...current, state: "paused" };
    setCurrentStatus(context.tenantId, paused);
    broadcastToSubscribers(context.tenantId, paused);
    response.json(paused);
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
        const updated = {
          ...current,
          ...progress,
          state: progress.running ? "running" : current.state,
          running: progress.running
        };
        setCurrentStatus(tenantId, updated);
        broadcastToSubscribers(tenantId, updated);
      }
    });

  void (correlationId ? runWithLogContext(correlationId, runJob) : runJob())
    .then((summary) => {
      const completedAt = new Date().toISOString();
      const current = getCurrentStatus(tenantId);
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
      setCurrentStatus(tenantId, nextStatus);
      broadcastToSubscribers(tenantId, nextStatus);
      logger.info(summary.paused ? "ingestion.job.paused" : "ingestion.job.complete", { ...summary, correlationId: correlationId ?? null, tenantId });
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
      broadcastToSubscribers(tenantId, nextStatus);
      logger.error("ingestion.job.failed", {
        error: error instanceof Error ? error.message : String(error),
        correlationId: correlationId ?? null,
        tenantId
      });
    });

  return runningStatus;
}

function multerErrorMessage(error: multer.MulterError): string {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return "One or more files exceed the 20 MB size limit. Please upload smaller files.";
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return "You can upload up to 50 files at a time. Please select fewer files and try again.";
    case "LIMIT_FIELD_KEY":
    case "LIMIT_FIELD_VALUE":
    case "LIMIT_FIELD_COUNT":
    case "LIMIT_PART_COUNT":
      return "The upload request was too large. Please try again with fewer files.";
    default:
      return "File upload failed. Please try again.";
  }
}
