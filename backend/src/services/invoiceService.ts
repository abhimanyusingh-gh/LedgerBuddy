import { Types } from "mongoose";
import { InvoiceModel } from "../models/Invoice.js";
import { env } from "../config/env.js";
import type { GstBreakdown, ParsedInvoiceData, ComplianceRiskSignal } from "../types/invoice.js";
import { assessInvoiceConfidence } from "./confidenceAssessment.js";
import { toMinorUnits } from "../utils/currency.js";
import type { AuthenticatedRequestContext } from "../types/auth.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { logger } from "../utils/logger.js";
import type { ApprovalWorkflowService } from "./approvalWorkflowService.js";
import { buildCorrectionHint, type ExtractionLearningStore } from "./extraction/extractionLearningStore.js";
import type { ExtractionMappingService } from "./extraction/extractionMappingService.js";
import { TdsCalculationService } from "./compliance/TdsCalculationService.js";
import { GlCodeMasterModel } from "../models/GlCodeMaster.js";
import { TenantTcsConfigModel } from "../models/TenantTcsConfig.js";
import {
  InvoiceUpdateError,
  sanitizeParsedData,
  sanitizeForApi,
  isCompleteParsedData,
  isPlainObject,
  getParsedField,
  applyNullableField,
  normalizeNullable,
  normalizeNullableCurrency,
  normalizeNullableMinorAmount,
  normalizeNullableMajorAmount,
  normalizeNullableNotes
} from "./invoice/invoiceHelpers.js";
export { InvoiceUpdateError } from "./invoice/invoiceHelpers.js";

interface ListInvoicesParams {
  status?: string;
  tenantId: string;
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
  gst: Partial<GstBreakdown> | null;
}>;

const EDITABLE_PARSED_FIELDS = [
  "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
  "currency", "totalAmountMinor", "totalAmountMajor", "notes", "gst"
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
  private readonly mappingService?: ExtractionMappingService;

  constructor(options?: { fileStore?: FileStore; workflowService?: ApprovalWorkflowService; learningStore?: ExtractionLearningStore; mappingService?: ExtractionMappingService }) {
    this.fileStore = options?.fileStore;
    this.workflowService = options?.workflowService;
    this.learningStore = options?.learningStore;
    this.mappingService = options?.mappingService;
  }

  async listInvoices(params: ListInvoicesParams) {
    const baseQuery: Record<string, unknown> = { tenantId: params.tenantId };

    const query: Record<string, unknown> = { ...baseQuery };
    if (params.status) {
      const statuses = params.status.split(",").map(s => s.trim()).filter(Boolean);
      query.status = statuses.length === 1 ? statuses[0] : { $in: statuses };
    }
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
            ...(params.status ? { filtered: [{ $match: { status: query.status } }, { $count: "n" }] } : {}),
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

        const compliance = (item as Record<string, unknown>).compliance as Record<string, unknown> | undefined;
        if (compliance) {
          const riskSignals = compliance.riskSignals as Array<{ severity: string; status: string }> | undefined;
          const openSignals = riskSignals?.filter(s => s.status === "open") ?? [];
          const maxSev = openSignals.reduce((m: string | null, s) => {
            if (s.severity === "critical") return "critical";
            if (s.severity === "warning" && m !== "critical") return "warning";
            return m ?? s.severity;
          }, null as string | null);

          (sanitized as Record<string, unknown>).complianceSummary = {
            tdsSection: (compliance.tds as Record<string, unknown> | undefined)?.section ?? null,
            glCode: (compliance.glCode as Record<string, unknown> | undefined)?.code ?? null,
            riskSignalCount: openSignals.length,
            riskSignalMaxSeverity: maxSev
          };
          delete (sanitized as Record<string, unknown>).compliance;
        }

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
    if (validIds.length === 0) return { modifiedCount: 0, failedCount: 0 };

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
    return { modifiedCount: result.modifiedCount, failedCount: 0 };
  }

  private async approveWithWorkflow(validIds: Types.ObjectId[], authContext: AuthenticatedRequestContext): Promise<{ modifiedCount: number; failedCount: number }> {
    let advanced = 0;
    let failed = 0;
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
          else failed++;
        } catch {
          failed++;
        }
        continue;
      }

      if (invoice.status === "AWAITING_APPROVAL") {
        try {
          const result = await this.workflowService!.approveStep(invoiceId, authContext);
          if (result.advanced) advanced++;
          else failed++;
        } catch {
          failed++;
        }
      }
    }
    return { modifiedCount: advanced, failedCount: failed };
  }

  async retryInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return 0;

    const now = new Date();
    const result = await InvoiceModel.updateMany(
      { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $in: ["PENDING", "FAILED_OCR", "FAILED_PARSE", "NEEDS_REVIEW", "PARSED"] } },
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

    if (Object.prototype.hasOwnProperty.call(input, "gst")) {
      const gstInput = input.gst;
      if (gstInput === null) {
        delete nextParsed.gst;
      } else if (isPlainObject(gstInput)) {
        nextParsed.gst = { ...(nextParsed.gst ?? {}), ...gstInput } as GstBreakdown;
      }
    }

    const parsedFields: Array<keyof ParsedInvoiceData> = [
      "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
      "totalAmountMinor", "currency", "notes", "gst", "pan",
      "bankAccountNumber", "bankIfsc", "lineItems"
    ];
    for (const field of parsedFields) {
      invoice.set(`parsed.${field}`, getParsedField(nextParsed, field));
    }

    if (this.learningStore) {
      const correctionFields = ["invoiceNumber", "vendorName", "invoiceDate", "dueDate", "currency", "totalAmountMinor"] as const;
      const corrections = correctionFields
        .filter((f) => {
          const newVal = getParsedField(nextParsed, f);
          return newVal !== undefined && String(newVal) !== String(getParsedField(currentParsed, f) ?? "");
        })
        .map((f) => ({
          field: f,
          hint: buildCorrectionHint(f, getParsedField(currentParsed, f), getParsedField(nextParsed, f)),
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

    if (this.mappingService) {
      const gstin = (nextParsed as any)?.gst?.gstin as string | undefined;
      const vendorNameChanged = String(nextParsed.vendorName ?? "") !== String(currentParsed.vendorName ?? "");
      if (gstin && vendorNameChanged && nextParsed.vendorName) {
        this.mappingService.maybeSeedMappingFromCorrection(tenantId, id, currentParsed, nextParsed, updatedBy)
          .catch(err => logger.warn("extraction.mapping.seed.failed", { tenantId, invoiceId: id, err }));
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

  async retriggerCompliance(invoiceId: string, tenantId: string, newGlCode: string, newGlName: string) {
    if (!Types.ObjectId.isValid(invoiceId)) throw new InvoiceUpdateError("Invalid invoice id.", 400);

    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === "EXPORTED") throw new InvoiceUpdateError("Cannot retrigger compliance on an exported invoice.", 403);

    const parsed = sanitizeParsedData(invoice.toObject().parsed);
    const compliance = (invoice as unknown as Record<string, unknown>).compliance as Record<string, unknown> | undefined ?? {};

    (compliance as Record<string, unknown>).glCode = {
      code: newGlCode,
      name: newGlName,
      source: "manual",
      confidence: 100
    };

    const tdsService = new TdsCalculationService();
    try {
      const glDoc = await GlCodeMasterModel.findOne({ tenantId, code: newGlCode, isActive: true }).lean();
      const glCategory = glDoc?.category ?? newGlCode;
      const tdsResult = await tdsService.computeTds(parsed, tenantId, glCategory);
      (compliance as Record<string, unknown>).tds = tdsResult.tds;

      const existingSignals = ((compliance as Record<string, unknown>).riskSignals as ComplianceRiskSignal[]) ?? [];
      const nonTdsSignals = existingSignals.filter(s => !s.code.startsWith("TDS_"));
      (compliance as Record<string, unknown>).riskSignals = [...nonTdsSignals, ...tdsResult.riskSignals];
    } catch (error) {
      logger.warn("compliance.retrigger.tds.failed", {
        invoiceId, tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
      if (tcsConfig?.enabled && tcsConfig.ratePercent > 0 && parsed.totalAmountMinor && parsed.totalAmountMinor > 0) {
        const tcsAmount = Math.floor(parsed.totalAmountMinor * tcsConfig.ratePercent / 100);
        (compliance as Record<string, unknown>).tcs = {
          rate: tcsConfig.ratePercent,
          amountMinor: tcsAmount,
          source: "configured"
        };
      }
    } catch (error) {
      logger.warn("compliance.retrigger.tcs.failed", {
        invoiceId, tenantId,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    invoice.set("compliance", compliance);
    await invoice.save();

    logger.info("compliance.retrigger.complete", {
      invoiceId, tenantId, newGlCode, newGlName
    });

    return sanitizeForApi(invoice.toObject());
  }
}

