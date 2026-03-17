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

interface ListInvoicesParams {
  status?: string;
  tenantId: string;
  workloadTier?: WorkloadTier;
  page: number;
  limit: number;
}

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

export class InvoiceService {
  private readonly fileStore?: FileStore;

  constructor(options?: { fileStore?: FileStore }) {
    this.fileStore = options?.fileStore;
  }

  async listInvoices(params: ListInvoicesParams) {
    const baseQuery: Record<string, unknown> = { tenantId: params.tenantId };
    if (params.workloadTier) {
      baseQuery.workloadTier = params.workloadTier;
    }

    const query: Record<string, unknown> = { ...baseQuery };
    if (params.status) {
      query.status = params.status;
    }

    const skip = (params.page - 1) * params.limit;

    const contentHashFacet = {
      duplicateHashes: [
        { $match: { tenantId: params.tenantId, contentHash: { $ne: null } } },
        { $group: { _id: "$contentHash", count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } }
      ]
    };

    const [items, counts] = await Promise.all([
      InvoiceModel.find(query)
        .select({ ocrText: 0, ocrBlocks: 0 })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(params.limit)
        .lean(),
      InvoiceModel.aggregate([
        { $match: baseQuery },
        {
          $facet: {
            totalAll: [{ $count: "n" }],
            approved: [{ $match: { status: "APPROVED" } }, { $count: "n" }],
            pending: [{ $match: { status: { $in: ["PARSED", "NEEDS_REVIEW"] } } }, { $count: "n" }],
            ...(params.status ? { filtered: [{ $match: { status: params.status } }, { $count: "n" }] } : {}),
            ...contentHashFacet
          }
        }
      ])
    ]);

    const facet = counts[0] ?? {};
    const totalAll = facet.totalAll?.[0]?.n ?? 0;
    const approvedAll = facet.approved?.[0]?.n ?? 0;
    const pendingAll = facet.pending?.[0]?.n ?? 0;
    const total = params.status ? (facet.filtered?.[0]?.n ?? 0) : totalAll;

    const duplicateHashes = new Set<string>();
    for (const d of (facet.duplicateHashes ?? [])) duplicateHashes.add(d._id);

    return {
      items: items.map((item) => {
        const sanitized = sanitizeForApi(item);
        const hash = (item as Record<string, unknown>).contentHash as string | undefined;
        if (hash && duplicateHashes.has(hash)) {
          (sanitized as Record<string, unknown>).possibleDuplicate = true;
        }
        return sanitized;
      }),
      page: params.page,
      limit: params.limit,
      total,
      totalAll,
      approvedAll,
      pendingAll
    };
  }

  async getInvoiceById(id: string, tenantId: string) {
    if (!Types.ObjectId.isValid(id)) {
      return null;
    }

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId }).lean();
    return invoice ? sanitizeForApi(invoice) : null;
  }

  async approveInvoices(ids: string[], approvedBy = env.DEFAULT_APPROVER, authContext: AuthenticatedRequestContext) {
    const validIds = toObjectIds(ids);
    if (validIds.length === 0) {
      return 0;
    }

    const now = new Date();
    const result = await InvoiceModel.updateMany(
      {
        _id: { $in: validIds },
        tenantId: authContext.tenantId,
        status: { $in: ["PARSED", "NEEDS_REVIEW", "FAILED_PARSE"] }
      },
      {
        $set: {
          status: "APPROVED",
          approval: {
            approvedBy,
            approvedAt: now,
            userId: authContext.userId,
            email: authContext.email,
            role: authContext.role
          }
        },
        $push: {
          processingIssues: {
            $each: [`Approved: ${now.toISOString()} by ${authContext.email} (${authContext.userId})`],
            $slice: -50
          }
        }
      }
    );

    return result.modifiedCount;
  }

  async retryInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = toObjectIds(ids);
    if (validIds.length === 0) {
      return 0;
    }

    const now = new Date();
    const result = await InvoiceModel.updateMany(
      {
        _id: { $in: validIds },
        tenantId: authContext.tenantId,
        status: { $ne: "EXPORTED" }
      },
      {
        $set: { status: "PENDING" },
        $push: {
          processingIssues: {
            $each: [`Retry requested: ${now.toISOString()} by ${authContext.email}`],
            $slice: -50
          }
        }
      }
    );

    return result.modifiedCount;
  }

  async deleteInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = toObjectIds(ids);
    if (validIds.length === 0) {
      return 0;
    }

    const filter = {
      _id: { $in: validIds },
      tenantId: authContext.tenantId,
      status: { $ne: "EXPORTED" }
    };

    let storageKeys: string[] = [];
    if (this.fileStore) {
      const docs = await InvoiceModel.find(filter).select({ metadata: 1 }).lean();
      storageKeys = docs
        .map((doc) => {
          const meta = doc.metadata as Map<string, string> | Record<string, string> | undefined;
          if (meta instanceof Map) return meta.get("uploadKey");
          return typeof meta === "object" && meta !== null ? (meta as Record<string, string>).uploadKey : undefined;
        })
        .filter((key): key is string => typeof key === "string" && key.length > 0);
    }

    const result = await InvoiceModel.deleteMany(filter);

    if (this.fileStore && storageKeys.length > 0) {
      for (const key of storageKeys) {
        try {
          await this.fileStore.deleteObject(key);
        } catch (error) {
          logger.warn("invoice.delete.storage.cleanup.failed", {
            key,
            error: error instanceof Error ? error.message : String(error)
          });
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
    if (!Types.ObjectId.isValid(id)) {
      throw new InvoiceUpdateError("Invalid invoice id.", 400);
    }

    if (!containsSupportedParsedUpdate(input)) {
      throw new InvoiceUpdateError("At least one editable parsed field must be provided.", 400);
    }

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) {
      throw new InvoiceUpdateError("Invoice not found.", 404);
    }

    if (invoice.status === "EXPORTED") {
      throw new InvoiceUpdateError("Exported invoices cannot be modified.", 400);
    }

    const currentParsed = sanitizeParsedData(invoice.toObject().parsed);
    const nextParsed = { ...currentParsed };

    applyStringFieldUpdate(nextParsed, "invoiceNumber", input);
    applyStringFieldUpdate(nextParsed, "vendorName", input);
    applyStringFieldUpdate(nextParsed, "invoiceDate", input);
    applyStringFieldUpdate(nextParsed, "dueDate", input);

    const currencyUpdate = normalizeNullableCurrency(input, "currency");
    if (currencyUpdate !== undefined) {
      if (currencyUpdate === null) {
        delete nextParsed.currency;
      } else {
        nextParsed.currency = currencyUpdate;
      }
    }

    const normalizedMinorAmount = normalizeNullableMinorAmount(input, "totalAmountMinor");
    if (normalizedMinorAmount !== undefined) {
      if (normalizedMinorAmount === null) {
        delete nextParsed.totalAmountMinor;
      } else {
        nextParsed.totalAmountMinor = normalizedMinorAmount;
      }
    }

    const majorAmountUpdate = normalizeNullableMajorAmount(input, "totalAmountMajor");
    if (majorAmountUpdate !== undefined) {
      if (majorAmountUpdate === null) {
        delete nextParsed.totalAmountMinor;
      } else {
        nextParsed.totalAmountMinor = toMinorUnits(majorAmountUpdate, nextParsed.currency);
      }
    }

    const notesUpdate = normalizeNullableNotes(input, "notes");
    if (notesUpdate !== undefined) {
      if (notesUpdate === null || notesUpdate.length === 0) {
        delete nextParsed.notes;
      } else {
        nextParsed.notes = notesUpdate;
      }
    }

    invoice.set("parsed", nextParsed);

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

    if (invoice.status !== "APPROVED") {
      invoice.status = isCompleteParsedData(nextParsed) && confidence.riskFlags.length === 0 ? "PARSED" : "NEEDS_REVIEW";
    }

    const existingIssues = ((invoice.get("processingIssues") as string[] | undefined) ?? []).filter(
      (entry) => !entry.startsWith("Manual parsed field update:")
    );
    invoice.set(
      "processingIssues",
      [
        ...existingIssues,
        `Manual parsed field update: ${new Date().toISOString()} by ${updatedBy}.`
      ].slice(-50)
    );

    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }

  async renameAttachmentName(id: string, attachmentName: string, tenantId: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new InvoiceUpdateError("Invalid invoice id.", 400);
    }
    const trimmed = attachmentName.trim();
    if (!trimmed) {
      throw new InvoiceUpdateError("Attachment name cannot be empty.", 400);
    }

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) {
      throw new InvoiceUpdateError("Invoice not found.", 404);
    }
    if (invoice.status === "EXPORTED") {
      throw new InvoiceUpdateError("Exported invoices cannot be modified.", 400);
    }

    invoice.attachmentName = trimmed;
    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }
}

const EDITABLE_PARSED_FIELDS = [
  "invoiceNumber",
  "vendorName",
  "invoiceDate",
  "dueDate",
  "currency",
  "totalAmountMinor",
  "totalAmountMajor",
  "notes"
] as const;

function containsSupportedParsedUpdate(input: UpdateParsedFieldInput): boolean {
  return EDITABLE_PARSED_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(input, field));
}

function sanitizeParsedData(parsed: unknown): ParsedInvoiceData {
  if (!isPlainObject(parsed)) {
    return {};
  }

  const source = parsed as Record<string, unknown>;
  const notes = Array.isArray(source.notes)
    ? source.notes.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    : undefined;

  return {
    invoiceNumber: normalizeStringValue(source.invoiceNumber),
    vendorName: normalizeStringValue(source.vendorName),
    invoiceDate: normalizeStringValue(source.invoiceDate),
    dueDate: normalizeStringValue(source.dueDate),
    totalAmountMinor:
      typeof source.totalAmountMinor === "number" && Number.isInteger(source.totalAmountMinor)
        ? source.totalAmountMinor
        : undefined,
    currency: normalizeCurrency(source.currency),
    notes: notes && notes.length > 0 ? notes : undefined,
    gst: isPlainObject(source.gst) ? (source.gst as GstBreakdown) : undefined
  };
}

function applyStringFieldUpdate(
  parsed: ParsedInvoiceData,
  field: "invoiceNumber" | "vendorName" | "invoiceDate" | "dueDate",
  input: UpdateParsedFieldInput
) {
  const update = normalizeNullableString(input, field);
  if (update === undefined) {
    return;
  }

  if (update === null) {
    delete parsed[field];
    return;
  }

  parsed[field] = update;
}

function normalizeNullableString(
  source: Record<string, unknown>,
  field: "invoiceNumber" | "vendorName" | "invoiceDate" | "dueDate"
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return undefined;
  }

  const value = source[field];
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new InvoiceUpdateError(`${field} must be a string or null.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return trimmed;
}

function normalizeNullableCurrency(
  source: Record<string, unknown>,
  field: "currency"
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return undefined;
  }

  const value = source[field];
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new InvoiceUpdateError("currency must be a string or null.");
  }

  const normalized = normalizeCurrency(value);
  if (!normalized) {
    return null;
  }

  return normalized;
}

function normalizeNullableMinorAmount(
  source: Record<string, unknown>,
  field: "totalAmountMinor"
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return undefined;
  }

  const value = source[field];
  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new InvoiceUpdateError("totalAmountMinor must be a positive integer or null.");
  }

  return value;
}

function normalizeNullableMajorAmount(
  source: Record<string, unknown>,
  field: "totalAmountMajor"
): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return undefined;
  }

  const value = source[field];
  if (value === null) {
    return null;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
    }
    return value;
  }

  if (typeof value !== "string") {
    throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  }

  return parsed;
}

function normalizeNullableNotes(
  source: Record<string, unknown>,
  field: "notes"
): string[] | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) {
    return undefined;
  }

  const value = source[field];
  if (value === null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw new InvoiceUpdateError("notes must be an array of strings or null.");
  }

  const normalized = value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  return normalized;
}

function isCompleteParsedData(parsed: ParsedInvoiceData): boolean {
  const totalAmountMinor = parsed.totalAmountMinor;
  return Boolean(
    parsed.invoiceNumber &&
      parsed.vendorName &&
      parsed.invoiceDate &&
      parsed.currency &&
      Number.isInteger(totalAmountMinor) &&
      typeof totalAmountMinor === "number" &&
      totalAmountMinor > 0
  );
}

function normalizeStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeForApi<T>(value: T): T {
  const sanitized = stripNulls(value);
  return (sanitized ?? {}) as T;
}

function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const entry of value) {
      const sanitized = stripNulls(entry);
      if (sanitized !== undefined) result.push(sanitized);
    }
    return result;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const sanitized = stripNulls(rawValue);
    if (sanitized !== undefined) {
      output[key] = sanitized;
    }
  }

  return output;
}

function toObjectIds(ids: string[]): Types.ObjectId[] {
  const result: Types.ObjectId[] = [];
  for (const id of ids) {
    if (Types.ObjectId.isValid(id)) result.push(new Types.ObjectId(id));
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
