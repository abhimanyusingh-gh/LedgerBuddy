import { getAuth } from "@/types/auth.js";
import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import multer from "multer";
import type { IngestionService } from "@/services/ingestion/ingestionService.js";
import type { EmailSimulationService } from "@/services/platform/emailSimulationService.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { logger } from "@/utils/logger.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { IngestionJobOrchestrator } from "@/services/ingestion/IngestionJobOrchestrator.js";
import { MAX_UPLOAD_FILE_COUNT, MAX_UPLOAD_FILE_SIZE_BYTES } from "@/constants.js";
import { isAllowedFileExtension } from "@/utils/validation.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_UPLOAD_FILE_COUNT }
});

export function createJobsRouter(
  ingestionService: IngestionService,
  emailSimulationService?: EmailSimulationService,
  fileStore?: FileStore
) {
  const router = Router();
  const orchestrator = new IngestionJobOrchestrator();
  router.use(requireAuth);

  router.get("/jobs/ingest/status", (req, res) => {
    res.json(orchestrator.getCurrentStatus(getAuth(req).tenantId));
  });

  router.get("/jobs/ingest/sse", (req, res) => {
    orchestrator.addSubscriber(getAuth(req).tenantId, res, req);
  });

  router.post("/jobs/ingest", requireCap("canStartIngestion"), async (req, res, next) => {
    try {
      res.status(202).json(orchestrator.startJob(ingestionService, getAuth(req).tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/ingest/email-simulate", requireCap("canStartIngestion"), async (req, res, next) => {
    try {
      const context = getAuth(req);
      const current = orchestrator.getCurrentStatus(context.tenantId);
      if (current.running) {
        res.status(202).json(current);
        return;
      }

      if (!emailSimulationService) {
        res.status(400).json({ message: "Email simulation service is unavailable." });
        return;
      }

      const simulation = await emailSimulationService.seedSampleEmails();
      logger.info("ingestion.email.simulation.seeded", {
        emailsSeeded: simulation.emailsSeeded,
        attachmentsSeeded: simulation.attachmentsSeeded,
        tenantId: context.tenantId
      });
      const status = orchestrator.startJob(ingestionService, context.tenantId);
      res.status(202).json({ ...status, emailSimulation: simulation });
    } catch (error) {
      if (error instanceof Error) {
        res.status(400).json({ message: error.message });
        return;
      }
      next(error);
    }
  });

  router.post("/jobs/upload", requireCap("canUploadFiles"), (req, res, next) => {
    (upload.array("files", MAX_UPLOAD_FILE_COUNT) as unknown as import("express").RequestHandler)(req, res, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        res.status(400).json({ message: multerErrorMessage(error) });
        return;
      }
      if (error) {
        next(error);
        return;
      }
      next();
    });
  }, async (req, res, next) => {
    try {
      const context = getAuth(req);
      if (!fileStore) {
        res.status(400).json({ message: "File storage is not configured." });
        return;
      }

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ message: "No files provided." });
        return;
      }

      const rejected = files.filter((f) => !isAllowedFileExtension(f.originalname));
      if (rejected.length > 0) {
        res.status(400).json({
          message: `Unsupported file type. Allowed extensions: .pdf, .jpg, .jpeg, .png. Rejected: ${rejected.map((f) => f.originalname).join(", ")}`
        });
        return;
      }

      const uploaded: string[] = [];
      let newlyCreated = 0;
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
          newlyCreated++;
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            logger.warn("jobs.upload.duplicate.skipped", {
              key,
              originalName: file.originalname,
              tenantId: context.tenantId
            });
          } else {
            throw error;
          }
        }

        uploaded.push(key);
      }

      if (orchestrator.getCurrentStatus(context.tenantId).running && newlyCreated > 0) {
        orchestrator.setPendingRerun(context.tenantId);
      }

      res.status(201).json({ uploaded, count: uploaded.length });
    } catch (error) {
      next(error);
    }
  });

  router.post("/jobs/ingest/pause", requireCap("canStartIngestion"), (req, res) => {
    res.json(orchestrator.pauseJob(ingestionService, getAuth(req).tenantId));
  });

  return router;
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
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
