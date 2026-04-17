import { Types } from "mongoose";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { env } from "@/config/env.js";
import { INVOICE_STATUS, GL_CODE_SOURCE, TCS_SOURCE, RISK_SIGNAL_STATUS, RISK_SIGNAL_SEVERITY } from "@/types/invoice.js";
import type { GstBreakdown, ParsedInvoiceData, ComplianceRiskSignal } from "@/types/invoice.js";
import { assessInvoiceConfidence } from "@/services/invoice/confidenceAssessment.js";
import { toMinorUnits } from "@/utils/currency.js";
import type { AuthenticatedRequestContext } from "@/types/auth.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { logger } from "@/utils/logger.js";
import { isRecord } from "@/utils/validation.js";
import type { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { buildCorrectionHint, type ExtractionLearningStore } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import type { ExtractionMappingService } from "@/ai/extractors/invoice/learning/extractionMappingService.js";
import { TdsCalculationService } from "@/services/compliance/TdsCalculationService.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
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
} from "@/services/invoice/invoiceHelpers.js";
export { InvoiceUpdateError } from "@/services/invoice/invoiceHelpers.js";
import { EXTRACTION_GROUP_TYPE } from "@/ai/extractors/invoice/learning/extractionLearningStore.js";
import type { SortDirection } from "@/types/sorting.js";

import type { UUID } from "@/types/uuid.js";

interface ListInvoicesParams {
  status?: string;
  tenantId: UUID;
  page: number;
  limit: number;
  from?: Date;
  to?: Date;
  approvedBy?: string;
  sortBy?: string;
  sortDir?: SortDirection;
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
  invoiceDate: string | Date | null;
  dueDate: string | Date | null;
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

const STRING_FIELDS = ["invoiceNumber", "vendorName"] as const;
const DATE_FIELDS = ["invoiceDate", "dueDate"] as const;

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
            approved: [{ $match: { status: INVOICE_STATUS.APPROVED } }, { $count: "n" }],
            pending: [{ $match: { status: { $in: [INVOICE_STATUS.PARSED, INVOICE_STATUS.NEEDS_REVIEW] } } }, { $count: "n" }],
            failed: [{ $match: { status: { $in: [INVOICE_STATUS.FAILED_OCR, INVOICE_STATUS.FAILED_PARSE] } } }, { $count: "n" }],
            needsReview: [{ $match: { status: INVOICE_STATUS.NEEDS_REVIEW } }, { $count: "n" }],
            parsed: [{ $match: { status: INVOICE_STATUS.PARSED } }, { $count: "n" }],
            awaitingApproval: [{ $match: { status: INVOICE_STATUS.AWAITING_APPROVAL } }, { $count: "n" }],
            failedOcr: [{ $match: { status: INVOICE_STATUS.FAILED_OCR } }, { $count: "n" }],
            failedParse: [{ $match: { status: INVOICE_STATUS.FAILED_PARSE } }, { $count: "n" }],
            exported: [{ $match: { status: INVOICE_STATUS.EXPORTED } }, { $count: "n" }],
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
          const openSignals = riskSignals?.filter(s => s.status === RISK_SIGNAL_STATUS.OPEN) ?? [];
          const maxSev = openSignals.reduce((m: string | null, s) => {
            if (s.severity === RISK_SIGNAL_SEVERITY.CRITICAL) return RISK_SIGNAL_SEVERITY.CRITICAL;
            if (s.severity === RISK_SIGNAL_SEVERITY.WARNING && m !== RISK_SIGNAL_SEVERITY.CRITICAL) return RISK_SIGNAL_SEVERITY.WARNING;
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

  async getInvoiceById(id: string, tenantId: UUID) {
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
      { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $in: [INVOICE_STATUS.PARSED, INVOICE_STATUS.NEEDS_REVIEW] } },
      {
        $set: {
          status: INVOICE_STATUS.APPROVED,
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

      if (invoice.status === INVOICE_STATUS.PARSED || invoice.status === INVOICE_STATUS.NEEDS_REVIEW) {
        const initiated = await this.workflowService!.initiateWorkflow(invoiceId, authContext.tenantId);
        if (!initiated) {
          const now = new Date();
          await InvoiceModel.updateOne(
            { _id: id, tenantId: authContext.tenantId, status: { $in: [INVOICE_STATUS.PARSED, INVOICE_STATUS.NEEDS_REVIEW] } },
            {
              $set: { status: INVOICE_STATUS.APPROVED, approval: { approvedBy: authContext.email, approvedAt: now, userId: authContext.userId, email: authContext.email, role: authContext.role } },
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

      if (invoice.status === INVOICE_STATUS.AWAITING_APPROVAL) {
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
      { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $in: [INVOICE_STATUS.PENDING, INVOICE_STATUS.FAILED_OCR, INVOICE_STATUS.FAILED_PARSE, INVOICE_STATUS.NEEDS_REVIEW, INVOICE_STATUS.PARSED] } },
      { $set: { status: INVOICE_STATUS.PENDING }, $push: { processingIssues: { $each: [`Retry requested: ${now.toISOString()} by ${authContext.email}`] } } }
    );
    return result.modifiedCount;
  }

  async deleteInvoices(ids: string[], authContext: AuthenticatedRequestContext) {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return 0;

    const filter = { _id: { $in: validIds }, tenantId: authContext.tenantId, status: { $ne: INVOICE_STATUS.EXPORTED } };

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
    tenantId: UUID
  ) {
    if (!Types.ObjectId.isValid(id)) throw new InvoiceUpdateError("Invalid invoice id.", 400);
    if (!EDITABLE_PARSED_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(input, f)))
      throw new InvoiceUpdateError("At least one editable parsed field must be provided.", 400);

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === INVOICE_STATUS.EXPORTED) throw new InvoiceUpdateError("Cannot modify an exported invoice.", 403);

    const currentParsed = sanitizeParsedData(invoice.toObject().parsed);
    const nextParsed = applyFieldUpdates(currentParsed, input);

    const parsedFields: Array<keyof ParsedInvoiceData> = [
      "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
      "totalAmountMinor", "currency", "notes", "gst", "pan",
      "bankAccountNumber", "bankIfsc", "lineItems"
    ];
    for (const field of parsedFields) {
      invoice.set(`parsed.${field}`, getParsedField(nextParsed, field));
    }

    recordFieldCorrections({
      learningStore: this.learningStore,
      mappingService: this.mappingService,
      currentParsed,
      nextParsed,
      invoice,
      tenantId,
      invoiceId: id,
      updatedBy
    });

    reassessConfidenceAfterEdit(invoice, nextParsed);
    determineStatusAfterEdit(invoice, nextParsed);

    invoice.set("processingIssues", [
      ...((invoice.get("processingIssues") as string[] | undefined) ?? []).filter((e) => !e.startsWith("Manual parsed field update:")),
      `Manual parsed field update: ${new Date().toISOString()} by ${updatedBy}.`
    ]);

    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }

  async renameAttachmentName(id: string, attachmentName: string, tenantId: UUID) {
    if (!Types.ObjectId.isValid(id)) throw new InvoiceUpdateError("Invalid invoice id.", 400);
    const trimmed = attachmentName.trim();
    if (!trimmed) throw new InvoiceUpdateError("Attachment name cannot be empty.", 400);

    const invoice = await InvoiceModel.findOne({ _id: id, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === INVOICE_STATUS.EXPORTED) throw new InvoiceUpdateError("Cannot modify an exported invoice.", 403);

    invoice.attachmentName = trimmed;
    await invoice.save();
    return sanitizeForApi(invoice.toObject());
  }

  async retriggerCompliance(invoiceId: string, tenantId: UUID, newGlCode: string, newGlName: string) {
    if (!Types.ObjectId.isValid(invoiceId)) throw new InvoiceUpdateError("Invalid invoice id.", 400);

    const invoice = await InvoiceModel.findOne({ _id: invoiceId, tenantId });
    if (!invoice) throw new InvoiceUpdateError("Invoice not found.", 404);
    if (invoice.status === INVOICE_STATUS.EXPORTED) throw new InvoiceUpdateError("Cannot retrigger compliance on an exported invoice.", 403);

    const parsed = sanitizeParsedData(invoice.toObject().parsed);
    const invoiceObj = invoice.toObject() as Record<string, unknown>;
    const compliance = isRecord(invoiceObj.compliance) ? invoiceObj.compliance : {};

    (compliance as Record<string, unknown>).glCode = {
      code: newGlCode,
      name: newGlName,
      source: GL_CODE_SOURCE.MANUAL,
      confidence: 100
    };

    await retriggerTdsAndTcs(compliance, parsed, tenantId, newGlCode, invoiceId);

    invoice.set("compliance", compliance);
    await invoice.save();

    logger.info("compliance.retrigger.complete", {
      invoiceId, tenantId, newGlCode, newGlName
    });

    return sanitizeForApi(invoice.toObject());
  }
}

interface RecordFieldCorrectionsInput {
  learningStore?: ExtractionLearningStore;
  mappingService?: ExtractionMappingService;
  currentParsed: ParsedInvoiceData;
  nextParsed: ParsedInvoiceData;
  invoice: InstanceType<typeof InvoiceModel>;
  tenantId: UUID;
  invoiceId: string;
  updatedBy: string;
}

function applyFieldUpdates(currentParsed: ParsedInvoiceData, input: UpdateParsedFieldInput): ParsedInvoiceData {
  const nextParsed = { ...currentParsed };

  for (const field of STRING_FIELDS) {
    const val = normalizeNullable(input, field, "string") as string | null | undefined;
    if (val === undefined) continue;
    if (val === null) delete nextParsed[field]; else nextParsed[field] = val;
  }

  for (const field of DATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    const raw = (input as Record<string, unknown>)[field];
    if (raw === null) { delete nextParsed[field]; continue; }
    const d = raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : undefined;
    if (d && !isNaN(d.getTime())) nextParsed[field] = d;
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

  return nextParsed;
}

function recordFieldCorrections(ctx: RecordFieldCorrectionsInput): void {
  if (ctx.learningStore) {
    const correctionFields = ["invoiceNumber", "vendorName", "invoiceDate", "dueDate", "currency", "totalAmountMinor"] as const;
    const corrections = correctionFields
      .filter((f) => {
        const newVal = getParsedField(ctx.nextParsed, f);
        return newVal !== undefined && String(newVal) !== String(getParsedField(ctx.currentParsed, f) ?? "");
      })
      .map((f) => ({
        field: f,
        hint: buildCorrectionHint(f, getParsedField(ctx.currentParsed, f), getParsedField(ctx.nextParsed, f)),
        count: 1,
        lastSeen: new Date()
      }))
      .filter((c) => c.hint.length > 0);

    if (corrections.length > 0) {
      const vendorFingerprint = ctx.invoice.metadata?.get("vendorFingerprint");
      const invoiceType = ctx.invoice.metadata?.get("invoiceType");
      logger.info("extraction.learning.correction.recorded", {
        tenantId: ctx.tenantId, invoiceId: ctx.invoiceId,
        correctedFields: corrections.map(c => c.field),
        vendorFingerprint: vendorFingerprint ?? null,
        invoiceType: invoiceType ?? null
      });
      if (vendorFingerprint) {
        ctx.learningStore.recordCorrections(ctx.tenantId, vendorFingerprint, EXTRACTION_GROUP_TYPE.VENDOR, corrections).catch((err) =>
          logger.warn("learning.record.vendor.failed", { tenantId: ctx.tenantId, error: err instanceof Error ? err.message : String(err) })
        );
      }
      if (invoiceType) {
        ctx.learningStore.recordCorrections(ctx.tenantId, invoiceType, EXTRACTION_GROUP_TYPE.INVOICE_TYPE, corrections).catch((err) =>
          logger.warn("learning.record.type.failed", { tenantId: ctx.tenantId, error: err instanceof Error ? err.message : String(err) })
        );
      }
    }
  }

  if (ctx.mappingService) {
    const gstin = ctx.nextParsed.gst?.gstin;
    const vendorNameChanged = String(ctx.nextParsed.vendorName ?? "") !== String(ctx.currentParsed.vendorName ?? "");
    if (gstin && vendorNameChanged && ctx.nextParsed.vendorName) {
      ctx.mappingService.maybeSeedMappingFromCorrection(ctx.tenantId, ctx.invoiceId, ctx.currentParsed, ctx.nextParsed, ctx.updatedBy)
        .catch(err => logger.warn("extraction.mapping.seed.failed", { tenantId: ctx.tenantId, invoiceId: ctx.invoiceId, err }));
    }
  }
}

function reassessConfidenceAfterEdit(invoice: InstanceType<typeof InvoiceModel>, nextParsed: ParsedInvoiceData): void {
  const confidence = assessInvoiceConfidence({
    ocrConfidence: invoice.ocrConfidence ?? undefined,
    parsed: nextParsed,
    warnings: [],
    complianceRiskPenalty: 0
  });

  invoice.set("confidenceScore", confidence.score);
  invoice.set("confidenceTone", confidence.tone);
  invoice.set("autoSelectForApproval", confidence.autoSelectForApproval);
}

function determineStatusAfterEdit(invoice: InstanceType<typeof InvoiceModel>, nextParsed: ParsedInvoiceData): void {
  if (invoice.status === INVOICE_STATUS.AWAITING_APPROVAL) {
    invoice.status = INVOICE_STATUS.NEEDS_REVIEW;
    invoice.set("workflowState", undefined);
    return;
  }

  if (invoice.status === INVOICE_STATUS.APPROVED) return;

  const invoiceObj = invoice.toObject() as Record<string, unknown>;
  const existingCompliance = isRecord(invoiceObj.compliance) ? invoiceObj.compliance : {};
  const existingRiskSignals = (existingCompliance.riskSignals ?? []) as Array<{ code: string; message: string; status: string }>;
  const openRiskSignals = existingRiskSignals.filter(s => s.status === "open");

  invoice.status = isCompleteParsedData(nextParsed) && openRiskSignals.length === 0 ? INVOICE_STATUS.PARSED : INVOICE_STATUS.NEEDS_REVIEW;
}

export async function retriggerTdsAndTcs(
  compliance: Record<string, unknown>,
  parsed: ParsedInvoiceData,
  tenantId: UUID,
  glCode: string,
  invoiceId: string
): Promise<void> {
  const tdsService = new TdsCalculationService();
  try {
    const glDoc = await GlCodeMasterModel.findOne({ tenantId, code: glCode, isActive: true }).lean();
    const glCategory = glDoc?.category ?? glCode;
    const tdsResult = await tdsService.computeTds(parsed, tenantId, glCategory);
    compliance.tds = tdsResult.tds;

    const existingSignals = (compliance.riskSignals as ComplianceRiskSignal[]) ?? [];
    const nonTdsSignals = existingSignals.filter(s => !s.code.startsWith("TDS_"));
    compliance.riskSignals = [...nonTdsSignals, ...tdsResult.riskSignals];
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
      compliance.tcs = {
        rate: tcsConfig.ratePercent,
        amountMinor: tcsAmount,
        source: TCS_SOURCE.CONFIGURED
      };
    }
  } catch (error) {
    logger.warn("compliance.retrigger.tcs.failed", {
      invoiceId, tenantId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

