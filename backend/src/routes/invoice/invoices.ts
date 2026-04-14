import { getAuth } from "@/types/auth.js";
import { Router, type Request, type Response, type NextFunction } from "express";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  InvoiceUpdateError,
  retriggerTdsAndTcs,
  type InvoiceService,
  type UpdateParsedFieldInput
} from "@/services/invoice/invoiceService.js";
import { env } from "@/config/env.js";
import { loadRuntimeManifest, type FolderSourceManifest } from "@/core/runtimeManifest.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { requireCap, resolveCapabilities } from "@/auth/requireCapability.js";
import { ViewerScopeModel } from "@/models/integration/ViewerScope.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { VendorMasterService } from "@/services/compliance/VendorMasterService.js";
import { GlCodeSuggestionService } from "@/services/compliance/GlCodeSuggestionService.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { logger } from "@/utils/logger.js";
import { isRecord, isString, validateDateRange } from "@/utils/validation.js";

let s3Client: S3Client | null = null;
const SOURCE_OVERLAY_FIELDS = new Set([
  "vendorName", "invoiceNumber", "invoiceDate", "dueDate", "totalAmountMinor", "currency",
  "gst.gstin", "gst.subtotalMinor", "gst.cgstMinor", "gst.sgstMinor", "gst.igstMinor", "gst.cessMinor", "gst.totalTaxMinor"
]);
const SOURCE_OVERLAY_LINE_ITEM_RE =
  /^lineItems\.\d+\.(?:row|description|hsnSac|quantity|rate|amountMinor|taxRate|cgstMinor|sgstMinor|igstMinor)$/;

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function wrap(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function requireStringIds(body: unknown): string[] | null {
  const ids = Array.isArray((body as Record<string, unknown>)?.ids)
    ? ((body as Record<string, unknown>).ids as unknown[]).filter(isString)
    : [];
  return ids.length > 0 ? ids : null;
}

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function parseMetadataJsonField(metadata: Record<string, string | undefined> | undefined, metaKey: string, lookupKey: string, fallbackKey?: string): string | null {
  const raw = metadata?.[metaKey];
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!isRecord(parsed)) return null;
  return trimOrNull(parsed[lookupKey]) ?? (fallbackKey ? trimOrNull(parsed[fallbackKey]) : null);
}

export function createInvoiceRouter(invoiceService: InvoiceService, fileStore?: FileStore) {
  const router = Router();
  router.use(requireAuth);
  const runtimeManifest = loadRuntimeManifest();
  const ALLOWED_SORT_COLUMNS = new Set(["file", "vendor", "invoiceNumber", "invoiceDate", "total", "confidence", "status", "received"]);

  function findFolderSource(invoice: { sourceKey: string; tenantId: string; workloadTier: string }) {
    return runtimeManifest.sources.find(
      (s): s is FolderSourceManifest =>
        s.type === "folder" && s.key === invoice.sourceKey &&
        s.tenantId === invoice.tenantId && s.workloadTier === invoice.workloadTier
    );
  }

  router.get("/invoices", wrap(async (req, res) => {
    const authContext = getAuth(req);
    const page = Math.max(Number(req.query.page ?? 1), 1);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const fromDate = parseIsoDate(req.query.from);
    const toDate = parseIsoDate(req.query.to);
    if (toDate) toDate.setHours(23, 59, 59, 999);
    const dateCheck = validateDateRange(fromDate ?? undefined, toDate ?? undefined);
    if (!dateCheck.valid) { res.status(400).json({ message: dateCheck.message }); return; }
    let approvedBy = typeof req.query.approvedBy === "string" ? req.query.approvedBy : undefined;

    const capabilities = await resolveCapabilities(req);
    if (capabilities.canViewAllInvoices !== true && !approvedBy) {
      const scope = await ViewerScopeModel.findOne({ tenantId: authContext.tenantId, viewerUserId: authContext.userId }).lean();
      if (scope && scope.visibleUserIds.length > 0) approvedBy = scope.visibleUserIds.join(",");
    }

    const rawSortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : undefined;
    const sortBy = rawSortBy && ALLOWED_SORT_COLUMNS.has(rawSortBy) ? rawSortBy : undefined;
    const rawSortDir = typeof req.query.sortDir === "string" ? req.query.sortDir : undefined;
    const sortDir: "asc" | "desc" | undefined = rawSortDir === "asc" || rawSortDir === "desc" ? rawSortDir : undefined;

    res.json(await invoiceService.listInvoices({
      page, limit, status, tenantId: authContext.tenantId,
      from: fromDate ?? undefined, to: toDate ?? undefined, approvedBy, sortBy, sortDir
    }));
  }));

  router.get("/invoices/:id", wrap(async (req, res) => {
    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }
    res.json(invoice);
  }));

  router.post("/invoices/approve", requireCap("canApproveInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy : undefined;
    const result = await invoiceService.approveInvoices(ids, approvedBy, getAuth(req));
    res.json(result);
  }));

  router.post("/invoices/retry", requireCap("canRetryInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    res.json({ modifiedCount: await invoiceService.retryInvoices(ids, getAuth(req)) });
  }));

  router.post("/invoices/delete", requireCap("canDeleteInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    res.json({ deletedCount: await invoiceService.deleteInvoices(ids, getAuth(req)) });
  }));

  router.patch("/invoices/:id", requireCap("canEditInvoiceFields"), wrap(async (req, res, next) => {
    try {
      const authContext = getAuth(req);
      if (typeof req.body?.attachmentName === "string") {
        res.json(await invoiceService.renameAttachmentName(req.params.id, req.body.attachmentName, authContext.tenantId));
        return;
      }

      const hasComplianceOverride = req.body?.glCode || typeof req.body?.glCode === "string" || req.body?.tdsSection || req.body?.vendorBankVerified || req.body?.dismissRiskSignal;
      if (hasComplianceOverride) {
        const invoice = await InvoiceModel.findOne({ _id: req.params.id, tenantId: authContext.tenantId });
        if (!invoice) { res.status(404).json({ message: "Invoice not found." }); return; }
        if (invoice.status === "EXPORTED") { res.status(403).json({ message: "Cannot modify an exported invoice." }); return; }

        const compliance = (invoice as unknown as Record<string, unknown>).compliance as Record<string, unknown> | undefined ?? {};

        if (typeof req.body.glCode === "string") {
          if (req.body.glCode.trim() === "") {
            (compliance as Record<string, unknown>).glCode = { code: null, name: null, source: "manual", confidence: null };
          } else {
            const glName = typeof req.body.glName === "string" && req.body.glName.trim() ? req.body.glName.trim() : req.body.glCode;
            const glService = new GlCodeSuggestionService();
            const fingerprint = invoice.metadata?.get("vendorFingerprint");
            if (fingerprint) {
              await glService.recordUsage(authContext.tenantId, fingerprint, req.body.glCode, glName);
            }
            (compliance as Record<string, unknown>).glCode = { code: req.body.glCode, name: glName, source: "manual", confidence: 100 };

            const parsed = invoice.toObject().parsed ?? {};
            await retriggerTdsAndTcs(compliance, parsed, authContext.tenantId, req.body.glCode, req.params.id);
          }
        }

        if (typeof req.body.tdsSection === "string") {
          const existingTds = (compliance as Record<string, unknown>).tds as Record<string, unknown> | undefined;
          (compliance as Record<string, unknown>).tds = { ...existingTds, section: req.body.tdsSection, source: "manual" };
        }

        if (req.body.vendorBankVerified === true) {
          const vendorBank = (compliance as Record<string, unknown>).vendorBank as Record<string, unknown> | undefined;
          if (vendorBank) {
            vendorBank.verifiedChange = true;
            vendorBank.isChanged = false;
          }
          const signals = ((compliance as Record<string, unknown>).riskSignals as Array<Record<string, unknown>>) ?? [];
          const bankSignal = signals.find(s => s.code === "VENDOR_BANK_CHANGED");
          if (bankSignal) {
            bankSignal.status = "acted-on";
            bankSignal.resolvedBy = authContext.userId;
            bankSignal.resolvedAt = new Date();
          }
        }

        if (typeof req.body.dismissRiskSignal === "string") {
          const signals = ((compliance as Record<string, unknown>).riskSignals as Array<Record<string, unknown>>) ?? [];
          const target = signals.find(s => s.code === req.body.dismissRiskSignal && s.status === "open");
          if (target) {
            target.status = "dismissed";
            target.resolvedBy = authContext.userId;
            target.resolvedAt = new Date();
          }
        }

        invoice.set("compliance", compliance);
        await invoice.save();
        const sanitized = JSON.parse(JSON.stringify(invoice.toObject()));
        res.json(sanitized);
        return;
      }

      res.json(await invoiceService.updateInvoiceParsedFields(
        req.params.id,
        (isRecord(req.body?.parsed) ? req.body.parsed : {}) as UpdateParsedFieldInput,
        typeof req.body?.updatedBy === "string" ? req.body.updatedBy : undefined,
        authContext.tenantId
      ));
    } catch (error) {
      if (error instanceof InvoiceUpdateError) { res.status(error.statusCode).json({ message: error.message }); return; }
      throw error;
    }
  }));

  router.post("/invoices/:id/retrigger-compliance", requireCap("canEditInvoiceFields"), wrap(async (req, res) => {
    try {
      const authContext = getAuth(req);
      const glCode = typeof req.body?.glCode === "string" ? req.body.glCode.trim() : null;
      const glName = typeof req.body?.glName === "string" ? req.body.glName.trim() : glCode;
      if (!glCode) { res.status(400).json({ message: "glCode is required." }); return; }
      const result = await invoiceService.retriggerCompliance(req.params.id, authContext.tenantId, glCode, glName ?? glCode);
      res.json(result);
    } catch (error) {
      if (error instanceof InvoiceUpdateError) { res.status(error.statusCode).json({ message: error.message }); return; }
      throw error;
    }
  }));

  router.get("/invoices/:id/document", wrap(async (req, res, next) => {
    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }
    if (invoice.sourceType !== "folder") { res.status(404).json({ message: "Original document is unavailable for this ingestion source." }); return; }

    const folderSource = findFolderSource(invoice);
    if (!folderSource) { res.status(404).json({ message: "Folder source configuration not found for this invoice." }); return; }

    const filePath = resolveSourceDocumentPath(folderSource.folderPath, invoice.sourceDocumentId);
    if (!filePath) { res.status(400).json({ message: "Invoice source document path is invalid." }); return; }

    try { await access(filePath, fsConstants.R_OK); } catch { res.status(404).json({ message: "Invoice source document was not found on disk." }); return; }

    res.type(invoice.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${invoice.attachmentName.replace(/["\\\r\n]/g, "_")}"`);
    safeSendFile(res, filePath, next);
  }));

  router.get("/invoices/:id/preview", wrap(async (req, res, next) => {
    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }
    const page = Math.max(1, Number(req.query.page ?? 1));
    const previewPath = parseMetadataJsonField(invoice.metadata, "previewPageImages", String(page), "1");

    if (previewPath) { await sendStoredImage(res, previewPath, "Preview image", next); return; }

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
            uploadKey, invoiceId: req.params.id,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    if (invoice.sourceType === "folder" && invoice.mimeType.startsWith("image/")) {
      const folderSource = findFolderSource(invoice);
      if (folderSource) {
        const imagePath = resolveSourceDocumentPath(folderSource.folderPath, invoice.sourceDocumentId);
        if (imagePath) {
          await access(imagePath, fsConstants.R_OK);
          res.type(invoice.mimeType);
          safeSendFile(res, imagePath, next);
          return;
        }
      }
    }

    res.status(404).json({ message: "Preview image not found for this invoice." });
  }));

  router.get("/invoices/:id/ocr-blocks/:index/crop", wrap(async (req, res, next) => {
    const blockIndex = Number.parseInt(req.params.index, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) { res.status(400).json({ message: "OCR block index must be a positive integer." }); return; }

    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }

    const blocks = invoice.ocrBlocks;
    const cropPath = Array.isArray(blocks) && blockIndex < blocks.length ? trimOrNull(blocks[blockIndex]?.cropPath) : null;
    if (!cropPath) { res.status(404).json({ message: "OCR block crop image was not found." }); return; }

    await sendStoredImage(res, cropPath, "OCR block crop image", next);
  }));

  router.get("/invoices/:id/source-overlays/:field", wrap(async (req, res, next) => {
    const field = String(req.params.field ?? "");
    if (!SOURCE_OVERLAY_FIELDS.has(field) && !SOURCE_OVERLAY_LINE_ITEM_RE.test(field)) {
      res.status(400).json({ message: "Unsupported source overlay field." });
      return;
    }

    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }

    const overlayPath = parseMetadataJsonField(invoice.metadata, "fieldOverlayPaths", field);
    if (!overlayPath) { res.status(404).json({ message: "Source overlay image was not found for this field." }); return; }

    await sendStoredImage(res, overlayPath, "Source overlay image", next);
  }));

  return router;
}

function resolveSourceDocumentPath(rootPath: string, relativePathValue: string): string | null {
  const root = path.resolve(rootPath);
  const resolved = path.resolve(root, relativePathValue);
  const relative = path.relative(root, resolved);
  return (relative.startsWith("..") || path.isAbsolute(relative)) ? null : resolved;
}

function inferImageMimeType(value: string): string {
  const n = value.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.S3_FILE_STORE_REGION,
      endpoint: env.S3_FILE_STORE_ENDPOINT?.trim() || undefined,
      forcePathStyle: env.S3_FILE_STORE_FORCE_PATH_STYLE
    });
  }
  return s3Client;
}

async function sendStoredImage(res: Response, value: string, label: string, next?: (err: unknown) => void): Promise<void> {
  if (value.startsWith("s3://")) {
    const withoutScheme = value.slice(5);
    const sep = withoutScheme.indexOf("/");
    if (sep <= 0 || sep >= withoutScheme.length - 1) { res.status(404).json({ message: `${label} path is invalid.` }); return; }

    const response = await getS3Client().send(
      new GetObjectCommand({ Bucket: withoutScheme.slice(0, sep), Key: withoutScheme.slice(sep + 1) })
    );
    if (!response.Body) { res.status(404).json({ message: `${label} object is unavailable.` }); return; }

    res.type((typeof response.ContentType === "string" ? response.ContentType : undefined) ?? inferImageMimeType(value));

    const bodyAsByteArray = response.Body as { transformToByteArray?: () => Promise<Uint8Array> };
    if (typeof bodyAsByteArray.transformToByteArray === "function") {
      res.send(Buffer.from(await bodyAsByteArray.transformToByteArray()));
      return;
    }

    if (response.Body instanceof Readable) {
      response.Body.on("error", () => {
        if (!res.headersSent) res.status(502).json({ message: `${label} stream failed.` });
        else res.destroy();
      });
      response.Body.pipe(res);
      return;
    }

    res.status(500).json({ message: `Unsupported ${label.toLowerCase()} stream response.` });
    return;
  }

  const resolved = path.resolve(value);
  const relative = path.relative(path.resolve("."), resolved);
  if (relative.startsWith("..") && path.isAbsolute(relative)) { res.status(404).json({ message: `${label} path is invalid.` }); return; }

  await access(resolved, fsConstants.R_OK);
  res.type(inferImageMimeType(resolved));
  if (next) safeSendFile(res, resolved, next);
  else res.sendFile(resolved);
}

function safeSendFile(res: Response, filePath: string, next: (err: unknown) => void): void {
  res.sendFile(filePath, (err) => { if (err && !res.headersSent) next(err); });
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const d = new Date(value.trim());
  return isNaN(d.getTime()) ? null : d;
}
