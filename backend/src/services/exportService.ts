import { Types } from "mongoose";
import type { AccountingExporter } from "../core/interfaces/AccountingExporter.js";
import type { FileStore } from "../core/interfaces/FileStore.js";
import { ExportBatchModel } from "../models/ExportBatch.js";
import { InvoiceModel } from "../models/Invoice.js";
import { logger } from "../utils/logger.js";

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

    const invoices = await InvoiceModel.find(query);
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
      system: this.exporter.system,
      total: results.length,
      successCount,
      failureCount,
      requestedBy: request.requestedBy
    });

    const resultMap = new Map(results.map((item) => [item.invoiceId, item]));

    const saveResults = await Promise.allSettled(
      invoices.map(async (invoice) => {
        const result = resultMap.get(String(invoice._id));
        if (!result) {
          return;
        }

        if (result.success) {
          invoice.status = "EXPORTED";
          invoice.export = {
            system: this.exporter.system,
            batchId: String(batch._id),
            exportedAt: new Date(),
            externalReference: result.externalReference
          };
        } else {
          invoice.export = {
            system: this.exporter.system,
            batchId: String(batch._id),
            exportedAt: new Date(),
            error: result.error
          };
          const existingIssues = (invoice.get("processingIssues") as string[] | undefined) ?? [];
          invoice.set("processingIssues", [...existingIssues, `Export failure: ${result.error}`]);
        }

        await invoice.save();
      })
    );
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

    const invoices = await InvoiceModel.find(query);
    if (invoices.length === 0) {
      return {
        batchId: undefined,
        fileKey: undefined,
        filename: undefined,
        total: 0,
        includedCount: 0,
        skippedCount: 0,
        skippedItems: []
      };
    }

    const fileResult = this.exporter.generateImportFile(invoices);
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
      system: this.exporter.system,
      total: invoices.length,
      successCount: fileResult.includedCount,
      failureCount: fileResult.skippedItems.length,
      requestedBy: request.requestedBy,
      fileKey
    });

    const skippedIds = new Set(fileResult.skippedItems.map((item) => item.invoiceId));
    const fileSaveResults = await Promise.allSettled(
      invoices.map(async (invoice) => {
        if (skippedIds.has(String(invoice._id))) {
          return;
        }
        invoice.status = "EXPORTED";
        invoice.export = {
          system: this.exporter.system,
          batchId: String(batch._id),
          exportedAt: new Date(),
          externalReference: fileKey
        };
        await invoice.save();
      })
    );
    for (const r of fileSaveResults) {
      if (r.status === "rejected") {
        logger.error("export.file.invoice.save.failed", {
          error: r.reason instanceof Error ? r.reason.message : String(r.reason)
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

  async downloadExportFile(batchId: string): Promise<{ body: Buffer; contentType: string; filename: string } | null> {
    if (!this.fileStore) {
      throw new Error("File store is required for export file retrieval.");
    }
    const batch = await ExportBatchModel.findById(batchId);
    if (!batch?.fileKey) {
      return null;
    }
    const file = await this.fileStore.getObject(batch.fileKey);
    const filename = batch.fileKey.split("/").pop() ?? "tally-export.xml";
    return { ...file, filename };
  }
}
