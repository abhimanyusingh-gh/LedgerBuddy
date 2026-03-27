import { Types } from "mongoose";
import { InvoiceModel } from "../models/Invoice.js";
import { env } from "../config/env.js";
import type { GstBreakdown, ParsedInvoiceData } from "../types/invoice.js";
import { assessInvoiceConfidence } from "./confidenceAssessment.js";
import { toMinorUnits } from "../utils/currency.js";
import type { WorkloadTier } from "../types/tenant.js";
import type { AuthenticatedRequestContext } from "../types/auth.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { logger } from "../utils/logger.js";
import type { ApprovalWorkflowService } from "./approvalWorkflowService.js";
import { buildCorrectionHint, type ExtractionLearningStore } from "./extraction/extractionLearningStore.js";

interface ListInvoicesParams {
  status?: string;
  tenantId: string;
  workloadTier?: WorkloadTier;
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
  approvedBy?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

const SORT_COLUMN_MAP: Record<string, string> = {
  file: "attachmentName",
  vendor: "parsed.vendorName",
  invoiceNumber: "parsed.invoiceNumber",
  invoiceDate: "parsed.invoiceDate",
  total: "parsed.totalAmountMinor",
  confidence: "confidenceScore",
  status: "status",
  received: "receivedAt"
};

export type UpdateParsedFieldInput = Partial<{
  invoiceNumber: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  totalAmountMinor: number | null;
  totalAmountMajor: number | string | null;
  notes: string[] | null;
}>;

export class InvoiceUpdateError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "InvoiceUpdateError";
  }
}

const EDITABLE_PARSED_FIELDS = [
  "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
  "currency", "totalAmountMinor", "totalAmountMajor", "notes"
] as const;

const STRING_FIELDS = ["invoiceNumber", "vendorName", "invoiceDate", "dueDate"] as const;

const FACET_RETURN_MAP: Record<string, string> = {
  totalAll: "totalAll", approved: "approvedAll", pending: "pendingAll",
  failed: "failedAll", needsReview: "needsReviewAll", parsed: "parsedAll",
  awaitingApproval: "awaitingApprovalAll", failedOcr: "failedOcrAll",
  failedParse: "failedParseAll", exported: "exportedAll"
};

export class InvoiceService {
  private readonly fileStore?: FileStore;
  private readonly workflowService?: ApprovalWorkflowService;
  private readonly learningStore?: ExtractionLearningStore;

  constructor(options?: { fileStore?: FileStore; workflowService?: ApprovalWorkflowService; learningStore?: ExtractionLearningStore }) {
    this.fileStore = options?.fileStore;
    this.workflowService = options?.workflowService;
    this.learningStore = options?.learningStore;
  }

  async listInvoices(params: ListInvoicesParams) {
    const baseQuery: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.workloadTier) baseQuery.workloadTier = params.workloadTier;

    const query: Record<string, unknown> = { ...baseQuery };
    if (params.status) query.status = params.status;
    if (params.from || params.to) {
      const dateFilter: Record<string, Date> = {};
      if (params.from) dateFilter.$gte = params.from;
      if (params.to) dateFilter.$lte = params.to;
      query.createdAt = dateFilter;
    }
    if (params.approvedBy) {
      const userIds = params.approvedBy.split(",").map((id) => id.trim()).filter(Boolean);
      query["approval.userId"] = userIds.length === 1 ? userIds[0] : { $in: userIds };
    }

    const mongoSortField = (params.sortBy && SORT_COLUMN_MAP[params.sortBy]) || "receivedAt";
    const mongoSortDir = params.sortDir === "asc" ? 1 : -1;

    const [items, counts] = await Promise.all([
      InvoiceModel.find(query)
        .select({ ocrText: 0, ocrBlocks: 0 })
        .sort({ [mongoSortField]: mongoSortDir })
        .skip((params.page - 1) * params.limit)
        .limit(params.limit)
        .lean(),
      InvoiceModel.aggregate([
        { $match: baseQuery },
        {
          $facet: {
            totalAll: [{ $count: "n" }],
            approved: [{ $match: { status: "APPROVED" } }, { $count: "n" }],
            pending: [{ $match: { status: { $in: ["PARSED", "NEEDS_REVIEW"] } } }, { $count: "n" }],
            failed: [{ $match: { status: { $in: ["FAILED_OCR", "FAILED_PARSE"] } } }, { $count: "n" }],
            needsReview: [{ $match: { status: "NEEDS_REVIEW" } }, { $count: "n" }],
            parsed: [{ $match: { status: "PARSED" } }, { $count: "n" }],
            awaitingApproval: [{ $match: { status: "AWAITING_APPROVAL" } }, { $count: "n" }],
            failedOcr: [{ $match: { status: "FAILED_OCR" } }, { $count: "n" }],
            failedParse: [{ $match: { status: "FAILED_PARSE" } }, { $count: "n" }],
            exported: [{ $match: { status: "EXPORTED" } }, { $count: "n" }],
            ...(params.status ? { filtered: [{ $match: { status: params.status } }, { $count: "n" }] } : {}),
            duplicateHashes: [
              { $match: { tenantId: params.tenantId, contentHash: { $ne: null } } },
              { $group: { _id: "$contentHash", count: { $sum: 1 } } },
              { $match: { count: { $gt: 1 } } }
            ]
          }
        }
      ])
    ]);

    const facet = counts[0] ?? {};
    const fc = (key: string) => facet[key]?.[0]?.n ?? 0;
    const duplicateHashes = new Set<string>((facet.duplicateHashes ?? []).map((d: { _id: string }) => d._id));

    const result: Record<string, unknown> = {
      items: items.map((item) => {
        const sanitized = sanitizeForApi(item);
        const hash = (item as Record<string, unknown>).contentHash as string | undefined;
        if (hash && duplicateHashes.has(hash)) (sanitized as Record<string, unknown>).possibleDuplicate = true;
        return sanitized;
      }),
      page: params.page,
      limit: params.limit,
      total: params.status ? fc("filtered") : fc("totalAll"),
    };
    for (const [facetKey, returnKey] of Object.entries(FACET_RETURN_MAP)) result[returnKey] = fc(facetKey);
    return result;
  }

  async getInvoiceById(id: string, tenantId: string) {
    if (!Types.ObjectId.isValid(id)) return null;
    const invoice = await InvoiceModel.findOne({ _id: id, tenantId }).lean();
    return invoice ? sanitizeForApi(invoice) : null;
  }

  async approveInvoices(ids: string[], approvedBy = env.DEFAULT_APPROVER, authContext: AuthenticatedRequestContext) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return 0;

    if (this.workflowService) {
      const workflowEnabled = await this.workflowService.isWorkflowEnabled(authContext.tenantId);
      if (workflowEnabled) return this.approveWithWorkflow(validIds, authContext);
    }

    const now = new Date();
    const result = await InvoiceModel.updateMany(
      { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $in: ["PARSED", "NEEDS_REVIEW"] } },
      {
        $set: {
          status: "APPROVED",
          approval: { approvedBy, approvedAt: now, userId: authContext.userId, email: authContext.email, role: authContext.role }
        },
        $push: { processingIssues: { $each: [`Approved: ${now.toISOString()} by ${authContext.email} (${authContext.userId})`] } }
      }
    );
    return result.modifiedCount;
  }

  private async approveWithWorkflow(validIds: Types.ObjectId[], authContext: AuthenticatedRequestContext): Promise<number> {
    let advanced = 0;
    for (const id of validIds) {
      const invoiceId = String(id);
      const invoice = await InvoiceModel.findOne({ _id: id, tenantId: authContext.tenantId }).lean();
      if (!invoice) continue;

      if (invoice.status === "PARSED" || invoice.status === "NEEDS_REVIEW") {
        const initiated = await this.workflowService!.initiateWorkflow(invoiceId, authContext.tenantId);
        if (!initiated) {
          const now = new Date();
          await InvoiceModel.updateOne(
            { _id: id, tenantId: authContext.tenantId, status: { $in: ["PARSED", "NEEDS_REVIEW"] } },
            {
              $set: { status: "APPROVED", approval: { approvedBy: authContext.email, approvedAt: now, userId: authContext.userId, email: authContext.email, role: authContext.role } },
              $push: { processingIssues: `Approved: ${now.toISOString()} by ${authContext.email} (${authContext.userId})` }
            }
          );
          advanced++;
          continue;
        }
        try {
          const result = await this.workflowService!.approveStep(invoiceId, authContext);
          if (result.advanced) advanced++;
        } catch {
          advanced++;
        }
        continue;
      }

      if (invoice.status === "AWAITING_APPROVAL") {
        try {
          const result = await this.workflowService!.approveStep(invoiceId, authContext);
          if (result.advanced) advanced++;
        } catch {
          continue;
        }
      }
    }
    return advanced;
  }

  async retryInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return 0;

    const now = new Date();
    const result = await InvoiceModel.updateMany(
      { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $in: ["FAILED_OCR", "FAILED_PARSE", "NEEDS_REVIEW", "PARSED"] } },
      { $set: { status: "PENDING" }, $push: { processingIssues: { $each: [`Retry requested: ${now.toISOString()} by ${authContext.email}`] } } }
    );
    return result.modifiedCount;
  }

  async deleteInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return 0;

    const filter = { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $ne: "EXPORTED" } };

    let storageKeys: string[] = [];
    if (this.fileStore) {
      const docs = await InvoiceModel.find(filter).select({ metadata: 1 }).lean();
      storageKeys = docs
        .map((doc) => {
          const meta = doc.metadata as Map<string, string> | Record<string, string> | undefined;
          return meta instanceof Map ? meta.get("uploadKey") : (meta as Record<string, string> | undefined)?.uploadKey;
        })
        .filter((key): key is string => typeof key === "string" && key.length > 0);
    }

    const result = await InvoiceModel.deleteMany(filter);

    if (this.fileStore && storageKeys.length > 0) {
      for (const key of storageKeys) {
        try { await this.fileStore.deleteObject(key); } catch (error) {
          logger.warn("invoice.delete.storage.cleanup.failed", { key, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
    return result.deletedCount;
  }

  async updateInvoiceParsedFields(
    id: string,
    input: UpdateParsedFieldInput,
    updatedBy = env.DEFAULT_APPROVER,
    tenantId: string
  ) {
    if (!Types.ObjectId.isValid(id)) throw new InvoiceUpdateError("Invalid invoice id.", 400);
    if (!EDITABLE_PARSED_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(input, f)))
      throw new InvoiceUpdateError("At least one editable parsed field must be provided.", 400);

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === "EXPORTED") throw new InvoiceUpdateError("Cannot modify an exported invoice.", 403);

    const currentParsed = sanitizeParsedData(invoice.toObject().parsed);
    const nextParsed = { ...currentParsed };

    for (const field of STRING_FIELDS) {
      const val = normalizeNullable(input, field, "string") as string | null | undefined;
      if (val === undefined) continue;
      if (val === null) delete nextParsed[field]; else nextParsed[field] = val;
    }

    applyNullableField(nextParsed, "currency", normalizeNullableCurrency(input));
    applyNullableField(nextParsed, "totalAmountMinor", normalizeNullableMinorAmount(input));

    const majorVal = normalizeNullableMajorAmount(input);
    if (majorVal !== undefined) {
      if (majorVal === null) delete nextParsed.totalAmountMinor;
      else nextParsed.totalAmountMinor = toMinorUnits(majorVal, nextParsed.currency);
    }

    const notesVal = normalizeNullableNotes(input);
    if (notesVal !== undefined) {
      if (notesVal === null || notesVal.length === 0) delete nextParsed.notes; else nextParsed.notes = notesVal;
    }

    invoice.set("parsed", nextParsed);

    if (this.learningStore) {
      const correctionFields = ["invoiceNumber", "vendorName", "invoiceDate", "dueDate", "currency", "totalAmountMinor"] as const;
      const corrections = correctionFields
        .filter((f) => {
          const newVal = (nextParsed as Record<string, unknown>)[f];
          return newVal !== undefined && String(newVal) !== String((currentParsed as Record<string, unknown>)[f] ?? "");
        })
        .map((f) => ({
          field: f,
          hint: buildCorrectionHint(f, (currentParsed as Record<string, unknown>)[f], (nextParsed as Record<string, unknown>)[f]),
          count: 1,
          lastSeen: new Date()
        }))
        .filter((c) => c.hint.length > 0);

      if (corrections.length > 0) {
        const vendorFingerprint = invoice.metadata?.get("vendorFingerprint");
        const invoiceType = invoice.metadata?.get("invoiceType");
        logger.info("extraction.learning.correction.recorded", {
          tenantId, invoiceId: id,
          correctedFields: corrections.map(c => c.field),
          vendorFingerprint: vendorFingerprint ?? null,
          invoiceType: invoiceType ?? null
        });
        if (vendorFingerprint) {
          this.learningStore.recordCorrections(tenantId, vendorFingerprint, "vendor", corrections).catch((err) =>
            logger.warn("learning.record.vendor.failed", { tenantId, error: err instanceof Error ? err.message : String(err) })
          );
        }
        if (invoiceType) {
          this.learningStore.recordCorrections(tenantId, invoiceType, "invoice-type", corrections).catch((err) =>
            logger.warn("learning.record.type.failed", { tenantId, error: err instanceof Error ? err.message : String(err) })
          );
        }
      }
    }

    const confidence = assessInvoiceConfidence({
      ocrConfidence: invoice.ocrConfidence ?? undefined,
      parsed: nextParsed,
      warnings: [],
      expectedMaxTotal: env.CONFIDENCE_EXPECTED_MAX_TOTAL,
      expectedMaxDueDays: env.CONFIDENCE_EXPECTED_MAX_DUE_DAYS,
      autoSelectMin: env.CONFIDENCE_AUTO_SELECT_MIN
    });

    invoice.set("confidenceScore", confidence.score);
    invoice.set("confidenceTone", confidence.tone);
    invoice.set("autoSelectForApproval", confidence.autoSelectForApproval);
    invoice.set("riskFlags", confidence.riskFlags);
    invoice.set("riskMessages", confidence.riskMessages);

    if (invoice.status === "AWAITING_APPROVAL") {
      invoice.status = "NEEDS_REVIEW";
      invoice.set("workflowState", undefined);
    } else if (invoice.status !== "APPROVED") {
      invoice.status = isCompleteParsedData(nextParsed) && confidence.riskFlags.length === 0 ? "PARSED" : "NEEDS_REVIEW";
    }

    invoice.set("processingIssues", [
      ...((invoice.get("processingIssues") as string[] | undefined) ?? []).filter((e) => !e.startsWith("Manual parsed field update:")),
      `Manual parsed field update: ${new Date().toISOString()} by ${updatedBy}.`
    ]);

    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }

  async renameAttachmentName(id: string, attachmentName: string, tenantId: string) {
    if (!Types.ObjectId.isValid(id)) throw new InvoiceUpdateError("Invalid invoice id.", 400);
    const trimmed = attachmentName.trim();
    if (!trimmed) throw new InvoiceUpdateError("Attachment name cannot be empty.", 400);

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === "EXPORTED") throw new InvoiceUpdateError("Cannot modify an exported invoice.", 403);

    invoice.attachmentName = trimmed;
    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }
}

function applyNullableField<K extends keyof ParsedInvoiceData>(parsed: ParsedInvoiceData, key: K, val: ParsedInvoiceData[K] | null | undefined) {
  if (val === undefined) return;
  if (val === null) delete parsed[key]; else parsed[key] = val;
}

function normalizeNullable(source: Record<string, unknown>, field: string, type: "string"): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) return undefined;
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== type) throw new InvoiceUpdateError(`${field} must be a string or null.`);
  const trimmed = (value as string).trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeNullableCurrency(source: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "currency")) return undefined;
  const value = source.currency;
  if (value === null) return null;
  if (typeof value !== "string") throw new InvoiceUpdateError("currency must be a string or null.");
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNullableMinorAmount(source: Record<string, unknown>): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "totalAmountMinor")) return undefined;
  const value = source.totalAmountMinor;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    throw new InvoiceUpdateError("totalAmountMinor must be a positive integer or null.");
  return value;
}

function normalizeNullableMajorAmount(source: Record<string, unknown>): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "totalAmountMajor")) return undefined;
  const value = source.totalAmountMajor;
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
    return value;
  }
  if (typeof value !== "string") throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  return parsed;
}

function normalizeNullableNotes(source: Record<string, unknown>): string[] | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "notes")) return undefined;
  const value = source.notes;
  if (value === null) return null;
  if (!Array.isArray(value)) throw new InvoiceUpdateError("notes must be an array of strings or null.");
  return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

function sanitizeParsedData(parsed: unknown): ParsedInvoiceData {
  if (!isPlainObject(parsed)) return {};
  const s = parsed as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const notes = Array.isArray(s.notes) ? s.notes.map((e) => String(e).trim()).filter((e) => e.length > 0) : undefined;
  return {
    invoiceNumber: str(s.invoiceNumber),
    vendorName: str(s.vendorName),
    invoiceDate: str(s.invoiceDate),
    dueDate: str(s.dueDate),
    totalAmountMinor: typeof s.totalAmountMinor === "number" && Number.isInteger(s.totalAmountMinor) ? s.totalAmountMinor : undefined,
    currency: typeof s.currency === "string" && s.currency.trim().toUpperCase().length > 0 ? s.currency.trim().toUpperCase() : undefined,
    notes: notes && notes.length > 0 ? notes : undefined,
    gst: isPlainObject(s.gst) ? (s.gst as GstBreakdown) : undefined
  };
}

function isCompleteParsedData(parsed: ParsedInvoiceData): boolean {
  return Boolean(
    parsed.invoiceNumber && parsed.vendorName && parsed.invoiceDate && parsed.currency &&
    typeof parsed.totalAmountMinor === "number" && Number.isInteger(parsed.totalAmountMinor) && parsed.totalAmountMinor > 0
  );
}

function sanitizeForApi<T>(value: T): T {
  return (stripNulls(value) ?? {}) as T;
}

function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(stripNulls).filter((v) => v !== undefined);
  if (!isPlainObject(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const sanitized = stripNulls(rawValue);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
