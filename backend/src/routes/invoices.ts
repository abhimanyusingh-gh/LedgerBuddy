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
import { getPreviewStorageRoot, isPathInsideRoot } from "../utils/previewStorage.js";

let s3Client: S3Client | null = null;
const SOURCE_OVERLAY_FIELDS = new Set([
  "vendorName",
  "invoiceNumber",
  "invoiceDate",
  "dueDate",
  "totalAmountMinor",
  "currency"
]);

export function createInvoiceRouter(invoiceService: InvoiceService) {
  const router = Router();
  const runtimeManifest = loadRuntimeManifest();

  router.get("/invoices", async (req, res, next) => {
    try {
      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const tenantId = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
      const workloadTier = parseWorkloadTier(req.query.workloadTier);

      const result = await invoiceService.listInvoices({ page, limit, status, tenantId, workloadTier });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id", async (req, res, next) => {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      res.json(invoice);
    } catch (error) {
      next(error);
    }
  });

  router.post("/invoices/approve", async (req, res, next) => {
    try {
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : [];
      const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy : undefined;

      if (ids.length === 0) {
        res.status(400).json({ message: "Body 'ids' must include at least one invoice id." });
        return;
      }

      const modifiedCount = await invoiceService.approveInvoices(ids, approvedBy);
      res.json({ modifiedCount });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/invoices/:id", async (req, res, next) => {
    try {
      const parsedInput = isRecord(req.body?.parsed) ? req.body.parsed : {};
      const updatedBy = typeof req.body?.updatedBy === "string" ? req.body.updatedBy : undefined;
      const updatedInvoice = await invoiceService.updateInvoiceParsedFields(
        req.params.id,
        parsedInput as UpdateParsedFieldInput,
        updatedBy
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
      const invoice = await invoiceService.getInvoiceById(req.params.id);
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
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/preview", async (req, res, next) => {
    try {
      const invoice = await invoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      if (invoice.sourceType !== "folder") {
        res.status(404).json({ message: "Preview is unavailable for this ingestion source." });
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

      if (invoice.mimeType.startsWith("image/")) {
        const imagePath = resolveSourceDocumentPath(folderSource.folderPath, invoice.sourceDocumentId);
        if (!imagePath) {
          res.status(400).json({ message: "Invoice source document path is invalid." });
          return;
        }
        await assertPathReadable(imagePath);
        res.type(invoice.mimeType);
        res.sendFile(imagePath);
        return;
      }

      if (invoice.mimeType !== "application/pdf") {
        res.status(415).json({ message: "Preview is unsupported for this file type." });
        return;
      }

      const page = Math.max(1, Number(req.query.page ?? 1));
      const previewPath = resolvePreviewImagePath(invoice.metadata, page, getPreviewStorageRoot());
      if (!previewPath) {
        res.status(404).json({ message: "Preview image not found for this PDF invoice." });
        return;
      }

      await assertPathReadable(previewPath);
      res.type(previewPath.endsWith(".jpg") || previewPath.endsWith(".jpeg") ? "image/jpeg" : "image/png");
      res.sendFile(previewPath);
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/ocr-blocks/:index/crop", async (req, res, next) => {
    try {
      const blockIndex = Number.parseInt(req.params.index, 10);
      if (!Number.isFinite(blockIndex) || blockIndex < 0) {
        res.status(400).json({ message: "OCR block index must be a positive integer." });
        return;
      }

      const invoice = await invoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      const cropPath = resolveOcrBlockCropPath(invoice.ocrBlocks, blockIndex);
      if (!cropPath) {
        res.status(404).json({ message: "OCR block crop image was not found." });
        return;
      }

      await sendStoredImage(res, cropPath, "OCR block crop image");
    } catch (error) {
      next(error);
    }
  });

  router.get("/invoices/:id/source-overlays/:field", async (req, res, next) => {
    try {
      const field = String(req.params.field ?? "");
      if (!SOURCE_OVERLAY_FIELDS.has(field)) {
        res.status(400).json({ message: "Unsupported source overlay field." });
        return;
      }

      const invoice = await invoiceService.getInvoiceById(req.params.id);
      if (!invoice) {
        res.status(404).json({ message: "Invoice not found" });
        return;
      }

      const overlayPath = resolveFieldOverlayPath(invoice.metadata, field);
      if (!overlayPath) {
        res.status(404).json({ message: "Source overlay image was not found for this field." });
        return;
      }

      await sendStoredImage(res, overlayPath, "Source overlay image");
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
  page: number,
  storageRoot: string
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

  const resolved = path.resolve(candidate);
  return isPathInsideRoot(storageRoot, resolved) ? resolved : null;
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

async function sendStoredImage(res: Response, value: string, label: string): Promise<void> {
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
      response.Body.pipe(res);
      return;
    }

    res.status(500).json({ message: `Unsupported ${label.toLowerCase()} stream response.` });
    return;
  }

  const storageRoot = path.resolve(env.LOCAL_FILE_STORE_ROOT);
  const resolved = path.resolve(value);
  if (!isPathInsideRoot(storageRoot, resolved)) {
    res.status(404).json({ message: `${label} path is invalid.` });
    return;
  }

  await assertPathReadable(resolved);
  res.type(inferImageMimeType(resolved));
  res.sendFile(resolved);
}

async function assertPathReadable(filePath: string): Promise<void> {
  await access(filePath, fsConstants.R_OK);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseWorkloadTier(value: unknown): WorkloadTier | undefined {
  if (value === "standard" || value === "heavy") {
    return value;
  }
  return undefined;
}
