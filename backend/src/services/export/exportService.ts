import { Types } from "mongoose";
import type { AccountingExporter, ExportResultItem } from "@/core/interfaces/AccountingExporter.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.js";
import {
  EXPORT_BATCH_ITEM_STATUS,
  EXPORT_BATCH_VOUCHER_TYPE
} from "@/models/invoice/exportBatch.item.js";
import { InvoiceModel, type InvoiceDocument } from "@/models/invoice/Invoice.js";
import { AuditLogModel } from "@/models/core/AuditLog.js";
import { logger } from "@/utils/logger.js";
import { EXPORT_SAVE_CONCURRENCY } from "@/constants.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { type UUID, toUUID } from "@/types/uuid.js";

interface ExportRequest {
  ids?: string[];
  requestedBy: string;
  tenantId: UUID;
  clientOrgId: Types.ObjectId;
}

interface RetryFailedItemsRequest {
  batchId: string;
  invoiceIds?: string[];
  paymentIds?: string[];
  requestedBy: string;
  tenantId: UUID;
  clientOrgId: Types.ObjectId;
}

interface ExportBatchItemSnapshot {
  invoiceId: string;
  paymentId?: string;
  voucherType: string;
  status: string;
  tallyResponse?: {
    lineError?: string;
    lineErrorOrdinal?: number;
    attempts?: Array<{
      exportVersion: number;
      lineError?: string;
      lineErrorOrdinal?: number;
      attemptedAt: Date;
    }>;
  };
  exportVersion: number;
  guid: string;
  completedAt?: Date;
}

const tenantRetryQueues = new Map<string, Promise<unknown>>();

function runWithTenantMutex<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  const previous = tenantRetryQueues.get(tenantId) ?? Promise.resolve();
  const settled = previous.then(() => undefined, () => undefined);
  const next = settled.then(() => work());
  const tracked = next.then(() => undefined, () => undefined);
  tenantRetryQueues.set(tenantId, tracked);
  void tracked.then(() => {
    if (tenantRetryQueues.get(tenantId) === tracked) {
      tenantRetryQueues.delete(tenantId);
    }
  });
  return next;
}

export class ExportBatchNotFoundError extends Error {
  readonly code = "EXPORT_BATCH_NOT_FOUND";
  constructor(batchId: string) {
    super(`Export batch ${batchId} not found.`);
  }
}

export class ExportRetryNoFailuresError extends Error {
  readonly code = "EXPORT_RETRY_NO_FAILURES";
  constructor(batchId: string) {
    super(`Export batch ${batchId} has no failure items to retry.`);
  }
}

export class ExportService {
  constructor(
    private readonly exporter: AccountingExporter,
    private readonly fileStore?: FileStore
  ) {}

  get canGenerateFiles(): boolean {
    return !!this.fileStore;
  }

  private async fetchExportableInvoices(request: ExportRequest) {
    const query: Record<string, unknown> = {
      status: INVOICE_STATUS.APPROVED,
      tenantId: request.tenantId,
      clientOrgId: request.clientOrgId
    };

    if (request.ids && request.ids.length > 0) {
      query._id = {
        $in: request.ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id))
      };
    }

    return InvoiceModel.find(query).select({ ocrText: 0 });
  }

  async exportApprovedInvoices(request: ExportRequest) {
    logger.info("export.run.start", {
      targetSystem: this.exporter.system,
      requestedBy: request.requestedBy,
      requestedIds: request.ids?.length ?? 0
    });

    const invoices = await this.fetchExportableInvoices(request);
    if (invoices.length === 0) {
      logger.info("export.run.complete", {
        targetSystem: this.exporter.system,
        total: 0,
        successCount: 0,
        failureCount: 0
      });
      return {
        batchId: undefined,
        total: 0,
        successCount: 0,
        failureCount: 0,
        items: []
      };
    }

    const results = await this.exporter.exportInvoices(invoices, request.tenantId);

    const successCount = results.filter((item) => item.success).length;
    const failureCount = results.length - successCount;
    const items = buildBatchItemsFromResults(results, EXPORT_BATCH_VOUCHER_TYPE.PURCHASE);

    const batch = await ExportBatchModel.create({
      tenantId: request.tenantId,
      clientOrgId: request.clientOrgId,
      system: this.exporter.system,
      total: results.length,
      successCount,
      failureCount,
      requestedBy: request.requestedBy,
      items
    });

    const resultMap = new Map(results.map((item) => [item.invoiceId, item]));
    const batchId = String(batch._id);

    const saveResults = await saveBatch(invoices, EXPORT_SAVE_CONCURRENCY, async (invoice) => {
      const result = resultMap.get(toUUID(String(invoice._id)));
      if (!result) {
        return;
      }

      const update: Record<string, unknown> = {};
      if (result.success) {
        update.status = INVOICE_STATUS.EXPORTED;
        update.export = {
          system: this.exporter.system,
          batchId,
          exportedAt: new Date(),
          externalReference: result.externalReference
        };
      } else {
        update.$push = { processingIssues: `Export failed: ${result.error}` };
      }

      await InvoiceModel.updateOne(
        { _id: invoice._id, tenantId: request.tenantId, clientOrgId: request.clientOrgId },
        update
      );
    });
    for (const r of saveResults) {
      if (r.status === "rejected") {
        logger.error("export.invoice.save.failed", {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
      }
    }

    const summary = {
      batchId: String(batch._id),
      total: results.length,
      successCount,
      failureCount,
      items: results
    };
    logger.info("export.run.complete", {
      targetSystem: this.exporter.system,
      batchId: summary.batchId,
      total: summary.total,
      successCount: summary.successCount,
      failureCount: summary.failureCount
    });
    return summary;
  }

  async generateExportFile(request: ExportRequest) {
    if (!this.exporter.generateImportFile) {
      throw new Error(`${this.exporter.system} exporter does not support file generation.`);
    }
    if (!this.fileStore) {
      throw new Error("File store is required for export file generation.");
    }

    const invoices = await this.fetchExportableInvoices(request);

    let alreadyExportedCount = 0;
    if (request.ids && request.ids.length > 0) {
      const foundIds = new Set(invoices.map((i) => String(i._id)));
      const missingIds = request.ids.filter((id) => Types.ObjectId.isValid(id) && !foundIds.has(id));
      if (missingIds.length > 0) {
        alreadyExportedCount = await InvoiceModel.countDocuments({
          _id: { $in: missingIds.map((id) => new Types.ObjectId(id)) },
          tenantId: request.tenantId,
          clientOrgId: request.clientOrgId,
          status: INVOICE_STATUS.EXPORTED
        });
      }
    }

    if (invoices.length === 0) {
      return {
        batchId: undefined,
        fileKey: undefined,
        filename: undefined,
        total: 0,
        includedCount: 0,
        skippedCount: alreadyExportedCount,
        skippedItems: [],
        alreadyExportedCount
      };
    }

    const fileResult = await this.exporter.generateImportFile(invoices, request.tenantId);

    if (fileResult.includedCount === 0) {
      return {
        batchId: undefined,
        fileKey: undefined,
        filename: undefined,
        total: invoices.length,
        includedCount: 0,
        skippedCount: fileResult.skippedItems.length,
        skippedItems: fileResult.skippedItems
      };
    }

    const fileKey = `tally-exports/${request.tenantId}/${fileResult.filename}`;

    await this.fileStore.putObject({
      key: fileKey,
      body: fileResult.content,
      contentType: fileResult.contentType,
      metadata: {
        requestedBy: request.requestedBy,
        tenantId: request.tenantId
      }
    });

    const batch = await ExportBatchModel.create({
      tenantId: request.tenantId,
      clientOrgId: request.clientOrgId,
      system: this.exporter.system,
      total: invoices.length,
      successCount: fileResult.includedCount,
      failureCount: fileResult.skippedItems.length,
      requestedBy: request.requestedBy,
      fileKey
    });

    const skippedIds = new Set(fileResult.skippedItems.map((item) => item.invoiceId));
    const batchId = String(batch._id);
    const now = new Date();
    const bulkOps = invoices
      .filter((invoice) => !skippedIds.has(toUUID(String(invoice._id))))
      .map((invoice) => ({
        updateOne: {
          filter: { _id: invoice._id, tenantId: request.tenantId, clientOrgId: request.clientOrgId },
          update: {
            status: INVOICE_STATUS.EXPORTED,
            export: {
              system: this.exporter.system,
              batchId,
              exportedAt: now,
              externalReference: fileKey
            }
          }
        }
      }));
    if (bulkOps.length > 0) {
      try {
        await InvoiceModel.bulkWrite(bulkOps);
      } catch (bulkError) {
        logger.error("export.file.invoice.bulkWrite.failed", {
          error: bulkError instanceof Error ? bulkError.message : String(bulkError)
        });
      }
    }

    logger.info("export.file.complete", {
      targetSystem: this.exporter.system,
      batchId: String(batch._id),
      fileKey,
      total: invoices.length,
      includedCount: fileResult.includedCount,
      skippedCount: fileResult.skippedItems.length
    });

    return {
      batchId: String(batch._id),
      fileKey,
      filename: fileResult.filename,
      total: invoices.length,
      includedCount: fileResult.includedCount,
      skippedCount: fileResult.skippedItems.length,
      skippedItems: fileResult.skippedItems
    };
  }

  async listExportHistory(params: { tenantId: UUID; clientOrgId: Types.ObjectId; page: number; limit: number }) {
    const query = { tenantId: params.tenantId, clientOrgId: params.clientOrgId };
    const skip = (params.page - 1) * params.limit;

    const [items, total] = await Promise.all([
      ExportBatchModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(params.limit).lean(),
      ExportBatchModel.countDocuments(query)
    ]);

    return {
      items: items.map((item) => ({
        batchId: String(item._id),
        system: item.system,
        total: item.total,
        successCount: item.successCount,
        failureCount: item.failureCount,
        requestedBy: item.requestedBy,
        hasFile: Boolean(item.fileKey),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        items: ((item as { items?: ExportBatchItemSnapshot[] }).items ?? []).map((entry) => ({
          invoiceId: entry.invoiceId,
          paymentId: entry.paymentId,
          voucherType: entry.voucherType,
          status: entry.status,
          exportVersion: entry.exportVersion,
          guid: entry.guid,
          completedAt: entry.completedAt,
          tallyResponse: entry.tallyResponse
            ? {
                lineError: entry.tallyResponse.lineError,
                lineErrorOrdinal: entry.tallyResponse.lineErrorOrdinal
              }
            : undefined
        }))
      })),
      page: params.page,
      limit: params.limit,
      total
    };
  }

  async retryFailedItems(request: RetryFailedItemsRequest) {
    return runWithTenantMutex(request.tenantId, async () => {
      const batch = await ExportBatchModel.findOne({
        _id: request.batchId,
        tenantId: request.tenantId,
        clientOrgId: request.clientOrgId
      });
      if (!batch) {
        throw new ExportBatchNotFoundError(request.batchId);
      }

      const existingItems: ExportBatchItemSnapshot[] = (batch.items ?? []) as ExportBatchItemSnapshot[];
      const { targetItems, failureItems } = this.#selectRetryTargets(existingItems, request);

      const orderedInvoices = await this.#fetchOrderedInvoices(targetItems, request);
      const results = await this.exporter.exportInvoices(orderedInvoices, request.tenantId, { forceAlter: true });
      const now = new Date();
      const { resultByInvoiceId, nextItems, successCount, failureCount } =
        await this.#mergeRetryResultsIntoBatch(batch, existingItems, results, now);

      const batchId = String(batch._id);
      await this.#applyResultsToInvoices(orderedInvoices, resultByInvoiceId, request, batchId, now);
      this.#writeRetryAuditLog(request, batchId, {
        priorFailureCount: failureItems.length,
        targetCount: targetItems.length,
        successCount,
        failureCount
      });

      logger.info("export.retry.complete", {
        targetSystem: this.exporter.system,
        batchId,
        retriedCount: targetItems.length,
        successCount,
        failureCount
      });

      return {
        batchId,
        retriedCount: targetItems.length,
        total: nextItems.length,
        successCount,
        failureCount,
        items: results
      };
    });
  }

  #selectRetryTargets(
    existingItems: ExportBatchItemSnapshot[],
    request: RetryFailedItemsRequest
  ): { targetItems: ExportBatchItemSnapshot[]; failureItems: ExportBatchItemSnapshot[] } {
    const failureItems = existingItems.filter((item) => item.status === EXPORT_BATCH_ITEM_STATUS.FAILURE);

    const requestedInvoiceIds = new Set(request.invoiceIds ?? []);
    const requestedPaymentIds = new Set(request.paymentIds ?? []);
    const hasFilter = requestedInvoiceIds.size > 0 || requestedPaymentIds.size > 0;

    const targetItems = hasFilter
      ? failureItems.filter((item) =>
          requestedInvoiceIds.has(item.invoiceId) ||
          (item.paymentId !== undefined && requestedPaymentIds.has(item.paymentId)))
      : failureItems;

    if (targetItems.length === 0) {
      throw new ExportRetryNoFailuresError(request.batchId);
    }

    return { targetItems, failureItems };
  }

  async #mergeRetryResultsIntoBatch(
    batch: { set: (key: string, value: unknown) => unknown; save: () => Promise<unknown> },
    existingItems: ExportBatchItemSnapshot[],
    results: ExportResultItem[],
    now: Date
  ): Promise<{
    resultByInvoiceId: Map<string, ExportResultItem>;
    nextItems: ExportBatchItemSnapshot[];
    successCount: number;
    failureCount: number;
  }> {
    const resultByInvoiceId = new Map<string, ExportResultItem>(
      results.map((r) => [String(r.invoiceId), r])
    );
    const nextItems = existingItems.map((item) => {
      const result = resultByInvoiceId.get(item.invoiceId);
      return result ? mergeRetryResultIntoItem(item, result, now) : item;
    });
    const successCount = nextItems.filter((i) => i.status === EXPORT_BATCH_ITEM_STATUS.SUCCESS).length;
    const failureCount = nextItems.filter((i) => i.status === EXPORT_BATCH_ITEM_STATUS.FAILURE).length;

    batch.set("items", nextItems);
    batch.set("successCount", successCount);
    batch.set("failureCount", failureCount);
    await batch.save();

    return { resultByInvoiceId, nextItems, successCount, failureCount };
  }

  async #fetchOrderedInvoices(
    targetItems: ExportBatchItemSnapshot[],
    request: RetryFailedItemsRequest
  ): Promise<InvoiceDocument[]> {
    const targetInvoiceIds = targetItems
      .map((item) => item.invoiceId)
      .filter((id) => Types.ObjectId.isValid(id));

    const invoices = (await InvoiceModel.find({
      _id: { $in: targetInvoiceIds.map((id) => new Types.ObjectId(id)) },
      tenantId: request.tenantId,
      clientOrgId: request.clientOrgId
    }).select({ ocrText: 0 })) as InvoiceDocument[];

    return targetItems
      .map((item) => invoices.find((inv) => toUUID(String(inv._id)) === item.invoiceId))
      .filter((inv): inv is InvoiceDocument => inv !== undefined);
  }

  async #applyResultsToInvoices(
    orderedInvoices: InvoiceDocument[],
    resultByInvoiceId: Map<string, ExportResultItem>,
    request: RetryFailedItemsRequest,
    batchId: string,
    now: Date
  ) {
    const saveResults = await saveBatch(orderedInvoices, EXPORT_SAVE_CONCURRENCY, async (invoice) => {
      const result = resultByInvoiceId.get(toUUID(String(invoice._id)));
      if (!result) return;
      if (result.success) {
        await InvoiceModel.updateOne(
          { _id: invoice._id, tenantId: request.tenantId, clientOrgId: request.clientOrgId },
          {
            status: INVOICE_STATUS.EXPORTED,
            export: {
              system: this.exporter.system,
              batchId,
              exportedAt: now,
              externalReference: result.externalReference
            }
          }
        );
      } else {
        await InvoiceModel.updateOne(
          { _id: invoice._id, tenantId: request.tenantId, clientOrgId: request.clientOrgId },
          { $push: { processingIssues: `Export retry failed: ${result.error}` } }
        );
      }
    });

    for (const r of saveResults) {
      if (r.status === "rejected") {
        logger.error("export.retry.invoice.save.failed", {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
        });
      }
    }
  }

  #writeRetryAuditLog(
    request: RetryFailedItemsRequest,
    batchId: string,
    summary: { priorFailureCount: number; targetCount: number; successCount: number; failureCount: number }
  ) {
    AuditLogModel.create({
      tenantId: request.tenantId,
      userId: request.requestedBy,
      entityType: "export",
      entityId: batchId,
      action: "export_batch_retry",
      previousValue: { failureCount: summary.priorFailureCount, targetCount: summary.targetCount },
      newValue: { successCount: summary.successCount, failureCount: summary.failureCount }
    }).catch((err) => {
      logger.error("audit_log.write_failed", {
        error: String(err),
        tenantId: request.tenantId,
        batchId
      });
    });
  }

  async downloadExportFile(
    batchId: string,
    tenantId: string,
    clientOrgId: Types.ObjectId
  ): Promise<{ body: Buffer; contentType: string; filename: string } | null> {
    if (!this.fileStore) {
      throw new Error("File store is required for export file retrieval.");
    }
    const query: Record<string, unknown> = { _id: batchId, tenantId, clientOrgId };
    const batch = await ExportBatchModel.findOne(query);
    if (!batch?.fileKey) {
      return null;
    }
    const file = await this.fileStore.getObject(batch.fileKey);
    const filename = batch.fileKey.split("/").pop() ?? "tally-export.xml";
    return { ...file, filename };
  }
}

function buildBatchItemsFromResults(
  results: ExportResultItem[],
  voucherType: string
): ExportBatchItemSnapshot[] {
  const now = new Date();
  return results.map((result) => {
    const status = result.success
      ? EXPORT_BATCH_ITEM_STATUS.SUCCESS
      : EXPORT_BATCH_ITEM_STATUS.FAILURE;
    const exportVersion = result.exportVersion ?? 0;
    const guid = result.guid ?? "";
    const item: ExportBatchItemSnapshot = {
      invoiceId: result.invoiceId,
      voucherType,
      status,
      exportVersion,
      guid,
      completedAt: now
    };
    if (!result.success) {
      const attempt = {
        exportVersion,
        lineError: result.error,
        lineErrorOrdinal: result.lineErrorOrdinal,
        attemptedAt: now
      };
      item.tallyResponse = {
        lineError: result.error,
        lineErrorOrdinal: result.lineErrorOrdinal,
        attempts: [attempt]
      };
    }
    return item;
  });
}

function mergeRetryResultIntoItem(
  prior: ExportBatchItemSnapshot,
  result: ExportResultItem,
  attemptedAt: Date
): ExportBatchItemSnapshot {
  const attempts = [...(prior.tallyResponse?.attempts ?? [])];
  attempts.push({
    exportVersion: result.exportVersion ?? prior.exportVersion,
    lineError: result.success ? undefined : result.error,
    lineErrorOrdinal: result.success ? undefined : result.lineErrorOrdinal,
    attemptedAt
  });

  const nextStatus = result.success
    ? EXPORT_BATCH_ITEM_STATUS.SUCCESS
    : EXPORT_BATCH_ITEM_STATUS.FAILURE;

  return {
    ...prior,
    status: nextStatus,
    exportVersion: result.exportVersion ?? prior.exportVersion,
    guid: result.guid ?? prior.guid,
    completedAt: attemptedAt,
    tallyResponse: result.success
      ? { ...prior.tallyResponse, attempts }
      : {
          lineError: result.error,
          lineErrorOrdinal: result.lineErrorOrdinal,
          attempts
        }
  };
}

async function saveBatch<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<PromiseSettledResult<void>[]> {
  const results: PromiseSettledResult<void>[] = [];
  for (let offset = 0; offset < items.length; offset += concurrency) {
    const batch = items.slice(offset, offset + concurrency);
    const settled = await Promise.allSettled(batch.map(fn));
    results.push(...settled);
  }
  return results;
}
