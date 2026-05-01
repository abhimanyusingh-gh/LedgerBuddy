import { Types } from "mongoose";
import { getAuth } from "@/types/auth.js";
import { DOCUMENT_MIME_TYPE } from "@/types/mime.js";
import { SORT_DIRECTION, type SortDirection } from "@/types/sorting.js";
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
import type { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { computeInvoiceActions, type InvoiceActionActor } from "@/services/invoice/invoiceActions.js";
import { env } from "@/config/env.js";
import { INVOICE_STATUS, GL_CODE_SOURCE, TDS_SOURCE, RISK_SIGNAL_STATUS } from "@/types/invoice.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";
import { INGESTION_SOURCE_TYPE } from "@/core/interfaces/IngestionSource.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { requireCap, resolveCapabilities } from "@/auth/requireCapability.js";
import { ViewerScopeModel } from "@/models/integration/ViewerScope.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { VendorMasterService } from "@/services/compliance/VendorMasterService.js";
import { GlCodeSuggestionService } from "@/services/compliance/GlCodeSuggestionService.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { logger } from "@/utils/logger.js";
import { isRecord, isString, validateDateRange } from "@/utils/validation.js";
import { INVOICE_URL_PATHS } from "@/routes/urls/invoiceUrls.js";

let s3Client: S3Client | null = null;

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

export function createInvoiceRouter(
  invoiceService: InvoiceService,
  workflowService: ApprovalWorkflowService,
  fileStore?: FileStore
) {
  const router = Router();
  router.use(requireAuth);
  const ALLOWED_SORT_COLUMNS = new Set(["file", "vendor", "invoiceNumber", "invoiceDate", "total", "confidence", "status", "received"]);

  async function buildActionActor(req: Request): Promise<InvoiceActionActor> {
    const authContext = getAuth(req);
    const capabilities = await resolveCapabilities(req);
    return { userId: authContext.userId, role: authContext.role, capabilities };
  }

  router.get(INVOICE_URL_PATHS.list, wrap(async (req, res) => {
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
    const sortDir: SortDirection | undefined = rawSortDir === SORT_DIRECTION.ASC || rawSortDir === SORT_DIRECTION.DESC ? rawSortDir : undefined;

    const response = await invoiceService.listInvoices({
      page, limit, status, tenantId: authContext.tenantId,
      from: fromDate ?? undefined, to: toDate ?? undefined, approvedBy, sortBy, sortDir
    });

    const actionActor: InvoiceActionActor = { userId: authContext.userId, role: authContext.role, capabilities };
    const workflowConfig = await workflowService.getWorkflowConfig(authContext.tenantId);
    const items = Array.isArray(response.items) ? (response.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      const status = item.status as string;
      const workflowState = item.workflowState as { currentStep?: number | null } | null | undefined;
      item.actions = computeInvoiceActions(actionActor, { status, workflowState }, workflowConfig);
    }

    res.json(response);
  }));

  router.get(INVOICE_URL_PATHS.detail, wrap(async (req, res) => {
    const authContext = getAuth(req);
    const invoice = await invoiceService.getInvoiceById(req.params.id, authContext.tenantId, req.activeClientOrgId!);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }

    const actor = await buildActionActor(req);
    const workflowConfig = await workflowService.getWorkflowConfig(authContext.tenantId);
    const invoiceRecord = invoice as Record<string, unknown>;
    const workflowState = invoiceRecord.workflowState as { currentStep?: number | null } | null | undefined;
    invoiceRecord.actions = computeInvoiceActions(
      actor,
      { status: invoiceRecord.status as string, workflowState },
      workflowConfig
    );

    res.json(invoice);
  }));

  router.post(INVOICE_URL_PATHS.approve, requireCap("canApproveInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    const approvedBy = typeof req.body?.approvedBy === "string" ? req.body.approvedBy : undefined;
    const result = await invoiceService.approveInvoices(ids, approvedBy, req.activeClientOrgId!, getAuth(req));
    res.json(result);
  }));

  router.post(INVOICE_URL_PATHS.retry, requireCap("canRetryInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    res.json({ modifiedCount: await invoiceService.retryInvoices(ids, req.activeClientOrgId!, getAuth(req)) });
  }));

  router.post(INVOICE_URL_PATHS.bulkDelete, requireCap("canDeleteInvoices"), wrap(async (req, res) => {
    const ids = requireStringIds(req.body);
    if (!ids) { res.status(400).json({ message: "Body 'ids' must include at least one invoice id." }); return; }
    res.json({ deletedCount: await invoiceService.deleteInvoices(ids, req.activeClientOrgId!, getAuth(req)) });
  }));

  router.patch(INVOICE_URL_PATHS.update, requireCap("canEditInvoiceFields"), wrap(async (req, res, next) => {
    try {
      const authContext = getAuth(req);
      if (typeof req.body?.attachmentName === "string") {
        res.json(await invoiceService.renameAttachmentName(req.params.id, req.body.attachmentName, authContext.tenantId, req.activeClientOrgId!));
        return;
      }

      const hasComplianceOverride = req.body?.glCode || typeof req.body?.glCode === "string" || req.body?.tdsSection || req.body?.vendorBankVerified || req.body?.dismissRiskSignal;
      if (hasComplianceOverride) {
        const invoice = await InvoiceModel.findOne({ _id: req.params.id, tenantId: authContext.tenantId, clientOrgId: req.activeClientOrgId });
        if (!invoice) { res.status(404).json({ message: "Invoice not found." }); return; }
        if (invoice.status === INVOICE_STATUS.EXPORTED) { res.status(403).json({ message: "Cannot modify an exported invoice." }); return; }

        const compliance = (invoice as unknown as Record<string, unknown>).compliance as Record<string, unknown> | undefined ?? {};

        if (typeof req.body.glCode === "string") {
          if (req.body.glCode.trim() === "") {
            (compliance as Record<string, unknown>).glCode = { code: null, name: null, source: GL_CODE_SOURCE.MANUAL, confidence: null };
          } else {
            const glName = typeof req.body.glName === "string" && req.body.glName.trim() ? req.body.glName.trim() : req.body.glCode;
            const glService = new GlCodeSuggestionService();
            const fingerprint = invoice.metadata?.get("vendorFingerprint");
            const invoiceClientOrgId = (invoice as unknown as { clientOrgId?: Types.ObjectId }).clientOrgId;
            if (fingerprint && invoiceClientOrgId) {
              await glService.recordUsage(authContext.tenantId, invoiceClientOrgId, fingerprint, req.body.glCode, glName);
            }
            (compliance as Record<string, unknown>).glCode = { code: req.body.glCode, name: glName, source: GL_CODE_SOURCE.MANUAL, confidence: 100 };

            const parsed = invoice.toObject().parsed ?? {};
            if (invoiceClientOrgId) {
              await retriggerTdsAndTcs(compliance, parsed, authContext.tenantId, invoiceClientOrgId, req.body.glCode, req.params.id, fingerprint);
            }
          }
        }

        if (typeof req.body.tdsSection === "string") {
          const existingTds = (compliance as Record<string, unknown>).tds as Record<string, unknown> | undefined;
          (compliance as Record<string, unknown>).tds = { ...existingTds, section: req.body.tdsSection, source: TDS_SOURCE.MANUAL };
        }

        if (req.body.vendorBankVerified === true) {
          const vendorBank = (compliance as Record<string, unknown>).vendorBank as Record<string, unknown> | undefined;
          if (vendorBank) {
            vendorBank.verifiedChange = true;
            vendorBank.isChanged = false;
          }
          const signals = ((compliance as Record<string, unknown>).riskSignals as Array<Record<string, unknown>>) ?? [];
          const bankSignal = signals.find(s => s.code === RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED);
          if (bankSignal) {
            bankSignal.status = RISK_SIGNAL_STATUS.ACTED_ON;
            bankSignal.resolvedBy = authContext.userId;
            bankSignal.resolvedAt = new Date();
          }
        }

        if (typeof req.body.dismissRiskSignal === "string") {
          const signals = ((compliance as Record<string, unknown>).riskSignals as Array<Record<string, unknown>>) ?? [];
          const target = signals.find(s => s.code === req.body.dismissRiskSignal && s.status === RISK_SIGNAL_STATUS.OPEN);
          if (target) {
            target.status = RISK_SIGNAL_STATUS.DISMISSED;
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
        authContext.tenantId,
        req.activeClientOrgId!
      ));
    } catch (error) {
      if (error instanceof InvoiceUpdateError) { res.status(error.statusCode).json({ message: error.message }); return; }
      throw error;
    }
  }));

  router.post(INVOICE_URL_PATHS.retriggerCompliance, requireCap("canEditInvoiceFields"), wrap(async (req, res) => {
    try {
      const authContext = getAuth(req);
      const glCode = typeof req.body?.glCode === "string" ? req.body.glCode.trim() : null;
      const glName = typeof req.body?.glName === "string" ? req.body.glName.trim() : glCode;
      if (!glCode) { res.status(400).json({ message: "glCode is required." }); return; }
      const result = await invoiceService.retriggerCompliance(req.params.id, authContext.tenantId, req.activeClientOrgId!, glCode, glName ?? glCode);
      res.json(result);
    } catch (error) {
      if (error instanceof InvoiceUpdateError) { res.status(error.statusCode).json({ message: error.message }); return; }
      throw error;
    }
  }));

  router.get(INVOICE_URL_PATHS.preview, wrap(async (req, res, next) => {
    const invoice = await invoiceService.getInvoiceById(req.params.id, getAuth(req).tenantId, req.activeClientOrgId!);
    if (!invoice) { res.status(404).json({ message: "Invoice not found" }); return; }
    const page = Math.max(1, Number(req.query.page ?? 1));
    const previewPath = parseMetadataJsonField(invoice.metadata, "previewPageImages", String(page), "1");

    if (previewPath) { await sendStoredImage(res, previewPath, "Preview image", next); return; }

    if (invoice.sourceType === INGESTION_SOURCE_TYPE.S3_UPLOAD && fileStore) {
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

    res.status(404).json({ message: "Preview image not found for this invoice." });
  }));

  return router;
}

function inferImageMimeType(value: string): string {
  const n = value.toLowerCase();
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return DOCUMENT_MIME_TYPE.JPEG;
  if (n.endsWith(".webp")) return DOCUMENT_MIME_TYPE.WEBP;
  return DOCUMENT_MIME_TYPE.PNG;
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
