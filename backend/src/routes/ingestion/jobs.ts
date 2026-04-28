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
import { INVOICE_STATUS } from "@/types/invoice.js";
import { INGESTION_SOURCE_TYPE } from "@/core/interfaces/IngestionSource.js";
import { requireCap } from "@/auth/requireCapability.js";
import { IngestionJobOrchestrator } from "@/services/ingestion/IngestionJobOrchestrator.js";
import { MAX_UPLOAD_FILE_COUNT, MAX_UPLOAD_FILE_SIZE_BYTES } from "@/constants.js";
import { isAllowedFileExtension } from "@/utils/validation.js";
import { guessMimeTypeFromKey } from "@/utils/mime.js";
import { INGESTION_URL_PATHS } from "@/routes/urls/ingestionUrls.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_BYTES, files: MAX_UPLOAD_FILE_COUNT }
});

function matchesMagicBytes(filename: string, buffer: Buffer): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  if (ext === ".pdf") return buffer.length >= 4 && buffer.subarray(0, 4).toString("ascii").startsWith("%PDF");
  if (ext === ".png") return buffer.length >= 4 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (ext === ".jpg" || ext === ".jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  return true;
}

export function createJobsRouter(
  ingestionService: IngestionService,
  emailSimulationService?: EmailSimulationService,
  fileStore?: FileStore
) {
  const router = Router();
  const orchestrator = new IngestionJobOrchestrator();
  router.use(requireAuth);

  router.get(INGESTION_URL_PATHS.jobsIngestStatus, (req, res) => {
    res.json(orchestrator.getCurrentStatus(getAuth(req).tenantId));
  });

  router.get(INGESTION_URL_PATHS.jobsIngestSse, (req, res) => {
    orchestrator.addSubscriber(getAuth(req).tenantId, res, req);
  });

  router.post(INGESTION_URL_PATHS.jobsIngest, requireCap("canStartIngestion"), async (req, res, next) => {
    try {
      res.status(202).json(orchestrator.startJob(ingestionService, getAuth(req).tenantId));
    } catch (error) {
      next(error);
    }
  });

  router.post(INGESTION_URL_PATHS.jobsIngestEmailSimulate, requireCap("canStartIngestion"), async (req, res, next) => {
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

  router.post(INGESTION_URL_PATHS.jobsUpload, requireCap("canUploadFiles"), (req, res, next) => {
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

      const ownedClientOrgId = req.activeClientOrgId;
      if (!ownedClientOrgId) {
        res.status(400).json({ message: "clientOrgId is required in the upload path." });
        return;
      }

      const rejected = files.filter((f) => !isAllowedFileExtension(f.originalname));
      if (rejected.length > 0) {
        res.status(400).json({
          message: `Unsupported file type. Allowed extensions: .pdf, .jpg, .jpeg, .png. Rejected: ${rejected.map((f) => f.originalname).join(", ")}`
        });
        return;
      }

      const magicMismatch = files.filter((f) => !matchesMagicBytes(f.originalname, f.buffer));
      if (magicMismatch.length > 0) {
        res.status(400).json({
          message: `File content does not match extension. Rejected: ${magicMismatch.map((f) => f.originalname).join(", ")}`
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
            clientOrgId: ownedClientOrgId,
            workloadTier: "standard",
            sourceType: INGESTION_SOURCE_TYPE.S3_UPLOAD,
            sourceKey: `s3-upload-${context.tenantId}`,
            sourceDocumentId: key,
            attachmentName: file.originalname,
            mimeType: file.mimetype,
            receivedAt: new Date(),
            status: INVOICE_STATUS.PENDING,
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

  router.post(INGESTION_URL_PATHS.jobsUploadByKeys, requireCap("canUploadFiles"), async (req, res, next) => {
    try {
      const context = getAuth(req);
      if (!fileStore) {
        res.status(400).json({ message: "File storage is not configured." });
        return;
      }

      const body = req.body as { keys?: unknown };
      if (!Array.isArray(body.keys) || body.keys.length === 0) {
        res.status(400).json({ message: "Request body must include a non-empty 'keys' array." });
        return;
      }

      if (body.keys.length > MAX_UPLOAD_FILE_COUNT) {
        res.status(400).json({ message: `Maximum ${MAX_UPLOAD_FILE_COUNT} keys per request.` });
        return;
      }

      const keys = body.keys as string[];
      const tenantPrefix = `uploads/${context.tenantId}/`;
      const invalid = keys.filter((k) => typeof k !== "string" || !k.startsWith(tenantPrefix));
      if (invalid.length > 0) {
        res.status(403).json({ message: "One or more keys do not belong to your tenant." });
        return;
      }

      const ownedClientOrgId = req.activeClientOrgId;
      if (!ownedClientOrgId) {
        res.status(400).json({ message: "clientOrgId is required in the upload path." });
        return;
      }

      const uploaded: string[] = [];
      let newlyCreated = 0;

      for (const key of keys) {
        const { body: fileBuffer, contentType } = await fileStore.getObject(key);
        const contentHash = createHash("sha256").update(fileBuffer).digest("base64url");
        const mimeType = contentType !== "application/octet-stream" ? contentType : guessMimeTypeFromKey(key);
        const fileName = key.split("/").pop() ?? key;

        try {
          await InvoiceModel.create({
            clientOrgId: ownedClientOrgId,
            workloadTier: "standard",
            sourceType: INGESTION_SOURCE_TYPE.S3_UPLOAD,
            sourceKey: `s3-upload-${context.tenantId}`,
            sourceDocumentId: key,
            attachmentName: fileName,
            mimeType,
            receivedAt: new Date(),
            status: INVOICE_STATUS.PENDING,
            contentHash,
            metadata: { uploadKey: key, systemFileName: fileName }
          });
          newlyCreated++;
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            logger.warn("jobs.upload-by-keys.duplicate.skipped", {
              key,
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

  router.post(INGESTION_URL_PATHS.jobsIngestPause, requireCap("canStartIngestion"), (req, res) => {
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
