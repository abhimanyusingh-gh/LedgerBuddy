import { Router, type Response } from "express";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  InvoiceUpdateError,
  type InvoiceService,
  type UpdateParsedFieldInput
} from "../services/invoiceService.js";
import { env } from "../config/env.js";
import { loadRuntimeManifest, type FolderSourceManifest } from "../core/runtimeManifest.js";
import type { WorkloadTier } from "../types/tenant.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { requireNotViewer } from "../auth/middleware.js";
import { ViewerScopeModel } from "../models/ViewerScope.js";
import { requireAuth } from "../auth/requireAuth.js";
import { logger } from "../utils/logger.js";
import { isRecord, isString, validateDateRange } from "../utils/validation.js";

let s3Client: S3Client | null = null;
const SOURCE_OVERLAY_FIELDS = new Set([
  "vendorName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "totalAmountMinor",
  "currency"
]);

export function createInvoiceRouter(invoiceService: InvoiceService, fileStore?: FileStore) {
  const router = Router();
  router.use(requireAuth);
  const runtimeManifest = loadRuntimeManifest();

  const ALLOWED_SORT_COLUMNS = new Set(["file", "vendor", "invoiceNumber", "invoiceDate", "total", "confidence", "status", "received"]);

  router.get("/invoices", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const workloadTier = parseWorkloadTier(req.query.workloadTier);
      const fromDate = parseIsoDate(req.query.from);
      const toDate = parseIsoDate(req.query.to);
      if (toDate) toDate.setHours(23, 59, 59, 999);
      const dateCheck = validateDateRange(fromDate ?? undefined, toDate ?? undefined);
      if (!dateCheck.valid) {
        res.status(400).json({ message: dateCheck.message });
        return;
      }
      let approvedBy = typeof req.query.approvedBy === "string" ? req.query.approvedBy : undefined;

      if (authContext.role === "VIEWER" && !approvedBy) {
        const scope = await ViewerScopeModel.findOne({ tenantId: authContext.tenantId, viewerUserId: authContext.userId }).lean();
        if (scope && scope.visibleUserIds.length > 0) {
          approvedBy = scope.visibleUserIds.join(",");
        }
      }

      const rawSortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : undefined;
      const sortBy = rawSortBy && ALLOWED_SORT_COLUMNS.has(rawSortBy) ? rawSortBy : undefined;
      const rawSortDir = typeof req.query.sortDir === "string" ? req.query.sortDir : undefined;
      const sortDir: "asc" | "desc" | undefined = rawSortDir === "asc" || rawSortDir === "desc" ? rawSortDir : undefined;

      const result = await invoiceService.listInvoices({
        page,
        limit,
        status,
        tenantId: authContext.tenantId,
        workloadTier,
        from: fromDate ?? undefined,
        to: toDate ?? undefined,
        approvedBy,
        sortBy,
        sortDir
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      res.json(invoice);
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoices/approve", requireNotViewer, async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : [];
      const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy : undefined;

      if (ids.length === 0) {
        res.status(400).json({ message: "Body 'ids' must include at least one invoice id." });
        return;
      }

      const modifiedCount = await invoiceService.approveInvoices(ids, approvedBy, authContext);
      res.json({ modifiedCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoices/retry", requireNotViewer, async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : [];

      if (ids.length === 0) {
        res.status(400).json({ message: "Body 'ids' must include at least one invoice id." });
        return;
      }

      const modifiedCount = await invoiceService.retryInvoices(ids, authContext);
      res.json({ modifiedCount });
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoices/delete", requireNotViewer, async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : [];

      if (ids.length === 0) {
        res.status(400).json({ message: "Body 'ids' must include at least one invoice id." });
        return;
      }

      const deletedCount = await invoiceService.deleteInvoices(ids, authContext);
      res.json({ deletedCount });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/invoices/:id", requireNotViewer, async (req, res, next) => {
    try {
      const authContext = req.authContext!;

      if (typeof req.body?.attachmentName === "string") {
        const updated = await invoiceService.renameAttachmentName(
          req.params.id,
          req.body.attachmentName,
          authContext.tenantId
        );
        res.json(updated);
        return;
      }

      const parsedInput = isRecord(req.body?.parsed) ? req.body.parsed : {};
      const updatedBy = typeof req.body?.updatedBy === "string" ? req.body.updatedBy : undefined;
      const updatedInvoice = await invoiceService.updateInvoiceParsedFields(
        req.params.id,
        parsedInput as UpdateParsedFieldInput,
        updatedBy,
        authContext.tenantId
      );
      res.json(updatedInvoice);
    } catch (error) {
      if (error instanceof InvoiceUpdateError) {
        res.status(error.statusCode).json({ message: error.message });
        return;
      }

      next(error);
    }
  });

  router.get("/invoices/:id/document", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      if (invoice.sourceType !== "folder") {
        res.status(404).json({ message: "Original document is unavailable for this ingestion source." });
        return;
      }

      const folderSource = runtimeManifest.sources.find(
        (source): source is FolderSourceManifest =>
          source.type === "folder" &&
          source.key === invoice.sourceKey &&
          source.tenantId === invoice.tenantId &&
          source.workloadTier === invoice.workloadTier
      );

      if (!folderSource) {
        res.status(404).json({ message: "Folder source configuration not found for this invoice." });
        return;
      }

      const filePath = resolveSourceDocumentPath(folderSource.folderPath, invoice.sourceDocumentId);
      if (!filePath) {
        res.status(400).json({ message: "Invoice source document path is invalid." });
        return;
      }

      try {
        await access(filePath, fsConstants.R_OK);
      } catch {
        res.status(404).json({ message: "Invoice source document was not found on disk." });
        return;
      }

      res.type(invoice.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${sanitizeContentDispositionName(invoice.attachmentName)}"`);
      safeSendFile(res, filePath, next);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/preview", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }
      const page = Math.max(1, Number(req.query.page ?? 1));
      const previewPath = resolvePreviewImagePath(invoice.metadata, page);

      if (previewPath) {
        await sendStoredImage(res, previewPath, "Preview image", next);
        return;
      }

      if (invoice.sourceType === "s3-upload" && fileStore) {
        const uploadKey = invoice.metadata?.uploadKey;
        if (typeof uploadKey === "string" && uploadKey.length > 0) {
          try {
            const obj = await fileStore.getObject(uploadKey);
            res.type(invoice.mimeType);
            res.send(obj.body);
            return;
          } catch (error) {
            logger.warn("invoices.preview.s3.fetch.failed", {
              uploadKey,
              invoiceId: req.params.id,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }

      if (invoice.sourceType === "folder" && invoice.mimeType.startsWith("image/")) {
        const folderSource = runtimeManifest.sources.find(
          (source): source is FolderSourceManifest =>
            source.type === "folder" &&
            source.key === invoice.sourceKey &&
            source.tenantId === invoice.tenantId &&
            source.workloadTier === invoice.workloadTier
        );
        if (folderSource) {
          const imagePath = resolveSourceDocumentPath(folderSource.folderPath, invoice.sourceDocumentId);
          if (imagePath) {
            await assertPathReadable(imagePath);
            res.type(invoice.mimeType);
            safeSendFile(res, imagePath, next);
            return;
          }
        }
      }

      res.status(404).json({ message: "Preview image not found for this invoice." });
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/ocr-blocks/:index/crop", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const blockIndex = Number.parseInt(req.params.index, 10);
      if (!Number.isFinite(blockIndex) || blockIndex < 0) {
        res.status(400).json({ message: "OCR block index must be a positive integer." });
        return;
      }

      const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      const cropPath = resolveOcrBlockCropPath(invoice.ocrBlocks, blockIndex);
      if (!cropPath) {
        res.status(404).json({ message: "OCR block crop image was not found." });
        return;
      }

      await sendStoredImage(res, cropPath, "OCR block crop image", next);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/source-overlays/:field", async (req, res, next) => {
    try {
      const authContext = req.authContext!;
      const field = String(req.params.field ?? "");
      if (!SOURCE_OVERLAY_FIELDS.has(field)) {
        res.status(400).json({ message: "Unsupported source overlay field." });
        return;
      }

      const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      const overlayPath = resolveFieldOverlayPath(invoice.metadata, field);
      if (!overlayPath) {
        res.status(404).json({ message: "Source overlay image was not found for this field." });
        return;
      }

      await sendStoredImage(res, overlayPath, "Source overlay image", next);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function resolveSourceDocumentPath(rootPath: string, relativePathValue: string): string | null {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, relativePathValue);
  const relative = path.relative(root, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}

function sanitizeContentDispositionName(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function resolvePreviewImagePath(
  metadata: Record<string, string | undefined> | undefined,
  page: number
): string | null {
  const rawMap = metadata?.previewPageImages;
  if (!rawMap) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMap);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const exact = typeof parsed[String(page)] === "string" ? String(parsed[String(page)]) : "";
  const fallback = typeof parsed["1"] === "string" ? String(parsed["1"]) : "";
  const candidate = exact || fallback;
  if (!candidate) {
    return null;
  }

  return candidate.trim().length > 0 ? candidate.trim() : null;
}

function resolveOcrBlockCropPath(
  blocks: Array<{ cropPath?: string | null }> | undefined,
  blockIndex: number
): string | null {
  if (!Array.isArray(blocks) || blockIndex >= blocks.length) {
    return null;
  }

  const value = blocks[blockIndex]?.cropPath;
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveFieldOverlayPath(
  metadata: Record<string, string | undefined> | undefined,
  field: string
): string | null {
  const rawMap = metadata?.fieldOverlayPaths;
  if (!rawMap) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawMap);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) {
    return null;
  }

  const candidate = parsed[field];
  if (typeof candidate !== "string") {
    return null;
  }

  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseS3Path(value: string): { bucket: string; key: string } | null {
  if (!value.startsWith("s3://")) {
    return null;
  }

  const withoutScheme = value.slice(5);
  const separatorIndex = withoutScheme.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex >= withoutScheme.length - 1) {
    return null;
  }

  return {
    bucket: withoutScheme.slice(0, separatorIndex),
    key: withoutScheme.slice(separatorIndex + 1)
  };
}

function inferImageMimeType(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized.endsWith(".jpg") || normalized.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (normalized.endsWith(".webp")) {
    return "image/webp";
  }
  return "image/png";
}

function getS3Client(): S3Client {
  if (s3Client) {
    return s3Client;
  }

  s3Client = new S3Client({
    region: env.S3_FILE_STORE_REGION,
    endpoint: env.S3_FILE_STORE_ENDPOINT?.trim() || undefined,
    forcePathStyle: env.S3_FILE_STORE_FORCE_PATH_STYLE
  });
  return s3Client;
}

async function sendStoredImage(res: Response, value: string, label: string, next?: (err: unknown) => void): Promise<void> {
  if (value.startsWith("s3://")) {
    const objectRef = parseS3Path(value);
    if (!objectRef) {
      res.status(404).json({ message: `${label} path is invalid.` });
      return;
    }

    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: objectRef.bucket,
        Key: objectRef.key
      })
    );
    if (!response.Body) {
      res.status(404).json({ message: `${label} object is unavailable.` });
      return;
    }

    const responseContentType = typeof response.ContentType === "string" ? response.ContentType : undefined;
    res.type(responseContentType ?? inferImageMimeType(value));

    const bodyAsByteArray = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (typeof bodyAsByteArray.transformToByteArray === "function") {
      const data = await bodyAsByteArray.transformToByteArray();
      res.send(Buffer.from(data));
      return;
    }

    if (response.Body instanceof Readable) {
      response.Body.on("error", () => {
        if (!res.headersSent) {
          res.status(502).json({ message: `${label} stream failed.` });
        } else {
          res.destroy();
        }
      });
      response.Body.pipe(res);
      return;
    }

    res.status(500).json({ message: `Unsupported ${label.toLowerCase()} stream response.` });
    return;
  }

  const resolved = path.resolve(value);
  const relative = path.relative(path.resolve("."), resolved);
  if (relative.startsWith("..") && path.isAbsolute(relative)) {
    res.status(404).json({ message: `${label} path is invalid.` });
    return;
  }

  await assertPathReadable(resolved);
  res.type(inferImageMimeType(resolved));
  if (next) {
    safeSendFile(res, resolved, next);
  } else {
    res.sendFile(resolved);
  }
}

async function assertPathReadable(filePath: string): Promise<void> {
  await access(filePath, fsConstants.R_OK);
}

function safeSendFile(res: Response, filePath: string, next: (err: unknown) => void): void {
  res.sendFile(filePath, (err) => {
    if (err && !res.headersSent) {
      next(err);
    }
  });
}

function parseWorkloadTier(value: unknown): WorkloadTier | undefined {
  if (value === "standard" || value === "heavy") {
    return value;
  }
  return undefined;
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}
