import { Types } from "mongoose";
import type { AccountingExporter } from "@/core/interfaces/AccountingExporter.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { logger } from "@/utils/logger.js";
import { EXPORT_SAVE_CONCURRENCY } from "@/constants.js";

interface ExportRequest {
  ids?: string[];
  requestedBy: string;
  tenantId: string;
}

export class ExportService {
  constructor(
    private readonly exporter: AccountingExporter,
    private readonly fileStore?: FileStore
  ) {}

  get canGenerateFiles(): boolean {
    return !!this.fileStore;
  }

  async exportApprovedInvoices(request: ExportRequest) {
    logger.info("export.run.start", {
      targetSystem: this.exporter.system,
      requestedBy: request.requestedBy,
      requestedIds: request.ids?.length ?? 0
    });
    const query: Record<string, unknown> = {
      status: "APPROVED",
      tenantId: request.tenantId
    };

    if (request.ids && request.ids.length > 0) {
      query._id = {
        $in: request.ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id))
      };
    }

    const invoices = await InvoiceModel.find(query).select({ ocrText: 0 });
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

    const results = await this.exporter.exportInvoices(invoices);

    const successCount = results.filter((item) => item.success).length;
    const failureCount = results.length - successCount;

    const batch = await ExportBatchModel.create({
      tenantId: request.tenantId,
      system: this.exporter.system,
      total: results.length,
      successCount,
      failureCount,
      requestedBy: request.requestedBy
    });

    const resultMap = new Map(results.map((item) => [item.invoiceId, item]));
    const batchId = String(batch._id);

    const saveResults = await saveBatch(invoices, EXPORT_SAVE_CONCURRENCY, async (invoice) => {
      const result = resultMap.get(String(invoice._id));
      if (!result) {
        return;
      }

      const update: Record<string, unknown> = {};
      if (result.success) {
        update.status = "EXPORTED";
        update.export = {
          system: this.exporter.system,
          batchId,
          exportedAt: new Date(),
          externalReference: result.externalReference
        };
      } else {
        update.$push = { processingIssues: `Export failed: ${result.error}` };
      }

      await InvoiceModel.updateOne({ _id: invoice._id }, update);
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

    const query: Record<string, unknown> = {
      status: "APPROVED",
      tenantId: request.tenantId
    };
    if (request.ids && request.ids.length > 0) {
      query._id = {
        $in: request.ids.filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id))
      };
    }

    const invoices = await InvoiceModel.find(query).select({ ocrText: 0 });

    let alreadyExportedCount = 0;
    if (request.ids && request.ids.length > 0) {
      const foundIds = new Set(invoices.map((i) => String(i._id)));
      const missingIds = request.ids.filter((id) => Types.ObjectId.isValid(id) && !foundIds.has(id));
      if (missingIds.length > 0) {
        alreadyExportedCount = await InvoiceModel.countDocuments({
          _id: { $in: missingIds.map((id) => new Types.ObjectId(id)) },
          tenantId: request.tenantId,
          status: "EXPORTED"
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

    const fileResult = this.exporter.generateImportFile(invoices);

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
      .filter((invoice) => !skippedIds.has(String(invoice._id)))
      .map((invoice) => ({
        updateOne: {
          filter: { _id: invoice._id },
          update: {
            status: "EXPORTED",
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

  async listExportHistory(params: { tenantId: string; page: number; limit: number }) {
    const query = { tenantId: params.tenantId };
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
        updatedAt: item.updatedAt
      })),
      page: params.page,
      limit: params.limit,
      total
    };
  }

  async downloadExportFile(
    batchId: string,
    tenantId?: string
  ): Promise<{ body: Buffer; contentType: string; filename: string } | null> {
    if (!this.fileStore) {
      throw new Error("File store is required for export file retrieval.");
    }
    const query: Record<string, unknown> = { _id: batchId };
    if (tenantId) {
      query.tenantId = tenantId;
    }
    const batch = await ExportBatchModel.findOne(query);
    if (!batch?.fileKey) {
      return null;
    }
    const file = await this.fileStore.getObject(batch.fileKey);
    const filename = batch.fileKey.split("/").pop() ?? "tally-export.xml";
    return { ...file, filename };
  }
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
