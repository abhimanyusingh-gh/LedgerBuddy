import { Types } from "mongoose";
import {
  ExportBatchNotFoundError,
  ExportRetryNoFailuresError,
  ExportService
} from "@/services/export/exportService.ts";
import { EXPORT_BATCH_ITEM_STATUS, ExportBatchModel } from "@/models/invoice/ExportBatch.ts";
import { InvoiceModel } from "@/models/invoice/Invoice.ts";
import { AuditLogModel } from "@/models/core/AuditLog.ts";
import type { AccountingExporter } from "@/core/interfaces/AccountingExporter.ts";
import type { FileStore } from "@/core/interfaces/FileStore.ts";
import { toUUID } from "@/types/uuid.js";

// Deterministic client-org for filter assertions.
const CLIENT_ORG_ID = new Types.ObjectId("0123456789abcdef01234567");

function createMockExporter(overrides?: Partial<AccountingExporter>): AccountingExporter {
  return {
    system: "tally",
    exportInvoices: jest.fn(async () => []),
    generateImportFile: jest.fn(() => ({
      filename: "tally-batch-20260309.xml",
      content: Buffer.from("<xml>test</xml>"),
      contentType: "text/xml",
      includedCount: 2,
      skippedItems: []
    })),
    ...overrides
  };
}

function createMockFileStore(): FileStore & { putObject: jest.Mock; getObject: jest.Mock } {
  return {
    name: "mock",
    putObject: jest.fn(async () => ({ key: "test-key", path: "test-path", contentType: "text/xml" })),
    getObject: jest.fn(async () => ({ body: Buffer.from("<xml/>"), contentType: "text/xml" })),
    deleteObject: jest.fn(async () => {})
  };
}

describe("ExportService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("listExportHistory", () => {
    it("returns empty items and total=0 when no batches exist for tenant", async () => {
      jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      } as never);
      jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(0 as never);

      const service = new ExportService(createMockExporter());
      const result = await service.listExportHistory({ tenantId: toUUID("tenant-a"), clientOrgId: CLIENT_ORG_ID, page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("returns paginated results with hasFile mapping", async () => {
      const batchId = new Types.ObjectId();
      const mockBatch = {
        _id: batchId,
        tenantId: toUUID("tenant-a"),
        system: "tally",
        total: 5,
        successCount: 4,
        failureCount: 1,
        requestedBy: "admin@test.com",
        fileKey: "tally-exports/tenant-a/batch.xml",
        createdAt: new Date("2026-03-01"),
        updatedAt: new Date("2026-03-01")
      };

      jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([mockBatch])
      } as never);
      jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(1 as never);

      const service = new ExportService(createMockExporter());
      const result = await service.listExportHistory({ tenantId: toUUID("tenant-a"), clientOrgId: CLIENT_ORG_ID, page: 1, limit: 20 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual(
        expect.objectContaining({
          batchId: String(batchId),
          system: "tally",
          total: 5,
          successCount: 4,
          failureCount: 1,
          requestedBy: "admin@test.com",
          hasFile: true
        })
      );
      expect(result.total).toBe(1);
    });

    it("sets hasFile to false when fileKey is absent", async () => {
      const batchId = new Types.ObjectId();
      const mockBatch = {
        _id: batchId,
        tenantId: toUUID("tenant-a"),
        system: "tally",
        total: 3,
        successCount: 0,
        failureCount: 3,
        requestedBy: "user@test.com",
        createdAt: new Date(),
        updatedAt: new Date()
      };

      jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([mockBatch])
      } as never);
      jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(1 as never);

      const service = new ExportService(createMockExporter());
      const result = await service.listExportHistory({ tenantId: toUUID("tenant-a"), clientOrgId: CLIENT_ORG_ID, page: 1, limit: 20 });

      expect(result.items[0].hasFile).toBe(false);
    });

    it("applies correct skip for page 2", async () => {
      const findSpy = jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      } as never);
      jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(25 as never);

      const service = new ExportService(createMockExporter());
      await service.listExportHistory({ tenantId: toUUID("tenant-a"), clientOrgId: CLIENT_ORG_ID, page: 2, limit: 10 });

      const chain = findSpy.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it("filters by {tenantId, clientOrgId} in both find and countDocuments", async () => {
      const findSpy = jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      } as never);
      const countSpy = jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(0 as never);

      const service = new ExportService(createMockExporter());
      await service.listExportHistory({ tenantId: toUUID("tenant-x"), clientOrgId: CLIENT_ORG_ID, page: 1, limit: 20 });

      expect(findSpy).toHaveBeenCalledWith({ tenantId: toUUID("tenant-x"), clientOrgId: CLIENT_ORG_ID });
      expect(countSpy).toHaveBeenCalledWith({ tenantId: toUUID("tenant-x"), clientOrgId: CLIENT_ORG_ID });
    });
  });

  describe("downloadExportFile", () => {
    it("returns null when batch is not found", async () => {
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(null as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      const result = await service.downloadExportFile("nonexistent-id", "tenant-a", CLIENT_ORG_ID);

      expect(result).toBeNull();
    });

    it("returns file content when batch exists with fileKey", async () => {
      const mockBatch = { fileKey: "tally-exports/tenant-a/batch.xml" };
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(mockBatch as never);

      const fileStore = createMockFileStore();
      const service = new ExportService(createMockExporter(), fileStore);
      const result = await service.downloadExportFile("batch-id-123", "tenant-a", CLIENT_ORG_ID);

      expect(result).not.toBeNull();
      expect(result!.filename).toBe("batch.xml");
      expect(fileStore.getObject).toHaveBeenCalledWith("tally-exports/tenant-a/batch.xml");
    });

    it("scopes download query by {tenantId, clientOrgId}", async () => {
      const findOneSpy = jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(null as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      await service.downloadExportFile("batch-123", "tenant-a", CLIENT_ORG_ID);

      expect(findOneSpy).toHaveBeenCalledWith({ _id: "batch-123", tenantId: "tenant-a", clientOrgId: CLIENT_ORG_ID });
    });

    it("throws when file store is not configured", async () => {
      const service = new ExportService(createMockExporter());
      await expect(service.downloadExportFile("batch-123", "tenant-a", CLIENT_ORG_ID)).rejects.toThrow(
        "File store is required for export file retrieval."
      );
    });
  });

  describe("generateExportFile", () => {
    it("returns empty result when no approved invoices exist", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({ select: jest.fn().mockResolvedValue([]) } as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      const result = await service.generateExportFile({
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      });

      expect(result.total).toBe(0);
      expect(result.batchId).toBeUndefined();
    });

    it("stores file via fileStore with correct key pattern", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: new Types.ObjectId(), status: "APPROVED" }
        ])
      } as never);
      jest.spyOn(InvoiceModel, "bulkWrite").mockResolvedValue({} as never);
      jest.spyOn(ExportBatchModel, "create").mockResolvedValue({
        _id: new Types.ObjectId()
      } as never);

      const fileStore = createMockFileStore();
      const service = new ExportService(createMockExporter(), fileStore);
      await service.generateExportFile({
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-c"),
        clientOrgId: CLIENT_ORG_ID
      });

      expect(fileStore.putObject).toHaveBeenCalledWith(
        expect.objectContaining({
          key: expect.stringContaining("tally-exports/tenant-c/"),
          contentType: "text/xml"
        })
      );
    });
  });

  describe("exportApprovedInvoices", () => {
    it("returns zero totals when no approved invoices exist", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({ select: jest.fn().mockResolvedValue([]) } as never);

      const service = new ExportService(createMockExporter());
      const result = await service.exportApprovedInvoices({
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      });

      expect(result.total).toBe(0);
      expect(result.batchId).toBeUndefined();
    });

    it("persists per-invoice items[] reflecting per-result success/failure status", async () => {
      const invoiceA = new Types.ObjectId();
      const invoiceB = new Types.ObjectId();
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: invoiceA },
          { _id: invoiceB }
        ])
      } as never);
      jest.spyOn(InvoiceModel, "updateOne").mockResolvedValue({} as never);
      const createSpy = jest.spyOn(ExportBatchModel, "create").mockResolvedValue({
        _id: new Types.ObjectId()
      } as never);

      const exporter = createMockExporter({
        exportInvoices: jest.fn(async () => [
          { invoiceId: toUUID(String(invoiceA)), success: true, exportVersion: 1, guid: "guid-a" },
          {
            invoiceId: toUUID(String(invoiceB)),
            success: false,
            error: "ledger missing",
            lineErrorOrdinal: 1,
            exportVersion: 1,
            guid: "guid-b"
          }
        ])
      });

      const service = new ExportService(exporter);
      await service.exportApprovedInvoices({
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      });

      const created = createSpy.mock.calls[0][0] as { items: Array<Record<string, unknown>> };
      expect(created.items).toHaveLength(2);
      expect(created.items[0]).toMatchObject({
        invoiceId: toUUID(String(invoiceA)),
        status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
        exportVersion: 1,
        guid: "guid-a"
      });
      expect(created.items[1]).toMatchObject({
        invoiceId: toUUID(String(invoiceB)),
        status: EXPORT_BATCH_ITEM_STATUS.FAILURE,
        exportVersion: 1,
        guid: "guid-b",
        tallyResponse: expect.objectContaining({
          lineError: "ledger missing",
          lineErrorOrdinal: 1
        })
      });
    });
  });

  describe("retryFailedItems", () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("throws ExportBatchNotFoundError when batch is missing", async () => {
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(null as never);
      const service = new ExportService(createMockExporter());
      await expect(service.retryFailedItems({
        batchId: "missing",
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      })).rejects.toBeInstanceOf(ExportBatchNotFoundError);
    });

    it("throws ExportRetryNoFailuresError when batch has no failures", async () => {
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue({
        _id: new Types.ObjectId(),
        items: [{ invoiceId: "i1", status: EXPORT_BATCH_ITEM_STATUS.SUCCESS }],
        save: jest.fn()
      } as never);
      const service = new ExportService(createMockExporter());
      await expect(service.retryFailedItems({
        batchId: "b1",
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      })).rejects.toBeInstanceOf(ExportRetryNoFailuresError);
    });

    it("invokes exporter with forceAlter=true and bumps exportVersion in items", async () => {
      const invoiceA = new Types.ObjectId();
      const invoiceId = toUUID(String(invoiceA));
      const setSpy = jest.fn();
      const saveSpy = jest.fn().mockResolvedValue(undefined);
      const batchId = new Types.ObjectId();
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue({
        _id: batchId,
        items: [
          {
            invoiceId,
            voucherType: "purchase",
            status: EXPORT_BATCH_ITEM_STATUS.FAILURE,
            exportVersion: 0,
            guid: "old-guid",
            tallyResponse: { lineError: "first failure", lineErrorOrdinal: 0, attempts: [] }
          }
        ],
        set: setSpy,
        save: saveSpy
      } as never);
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: invoiceA }])
      } as never);
      jest.spyOn(InvoiceModel, "updateOne").mockResolvedValue({} as never);
      jest.spyOn(AuditLogModel, "create").mockResolvedValue({} as never);

      const exportInvoicesMock = jest.fn(async () => [
        { invoiceId, success: true, exportVersion: 1, guid: "new-guid", externalReference: "VCH-1" }
      ]);
      const exporter = createMockExporter({ exportInvoices: exportInvoicesMock });

      const service = new ExportService(exporter);
      const result = await service.retryFailedItems({
        batchId: String(batchId),
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-a"),
        clientOrgId: CLIENT_ORG_ID
      });

      expect(exportInvoicesMock).toHaveBeenCalledWith(
        expect.any(Array),
        toUUID("tenant-a"),
        { forceAlter: true }
      );
      expect(result.successCount).toBe(1);
      expect(result.failureCount).toBe(0);
      const itemsUpdate = setSpy.mock.calls.find(([key]) => key === "items")?.[1] as Array<Record<string, unknown>>;
      expect(itemsUpdate[0]).toMatchObject({
        status: EXPORT_BATCH_ITEM_STATUS.SUCCESS,
        exportVersion: 1,
        guid: "new-guid"
      });
    });

    it("preserves prior failure history by appending to attempts[] when retry fails again", async () => {
      const invoiceA = new Types.ObjectId();
      const invoiceId = toUUID(String(invoiceA));
      const setSpy = jest.fn();
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue({
        _id: new Types.ObjectId(),
        items: [
          {
            invoiceId,
            voucherType: "purchase",
            status: EXPORT_BATCH_ITEM_STATUS.FAILURE,
            exportVersion: 0,
            guid: "old-guid",
            tallyResponse: {
              lineError: "first failure",
              lineErrorOrdinal: 0,
              attempts: [{ exportVersion: 0, lineError: "first failure", lineErrorOrdinal: 0, attemptedAt: new Date() }]
            }
          }
        ],
        set: setSpy,
        save: jest.fn().mockResolvedValue(undefined)
      } as never);
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([{ _id: invoiceA }])
      } as never);
      jest.spyOn(InvoiceModel, "updateOne").mockResolvedValue({} as never);
      jest.spyOn(AuditLogModel, "create").mockResolvedValue({} as never);

      const exporter = createMockExporter({
        exportInvoices: jest.fn(async () => [
          {
            invoiceId,
            success: false,
            error: "second failure",
            lineErrorOrdinal: 0,
            exportVersion: 1,
            guid: "newer-guid"
          }
        ])
      });

      const service = new ExportService(exporter);
      await service.retryFailedItems({
        batchId: "b1",
        requestedBy: "admin@test.com",
        tenantId: toUUID("tenant-b"),
        clientOrgId: CLIENT_ORG_ID
      });

      const itemsUpdate = setSpy.mock.calls.find(([key]) => key === "items")?.[1] as Array<Record<string, unknown>>;
      const tallyResponse = itemsUpdate[0].tallyResponse as { attempts: unknown[]; lineError: string };
      expect(tallyResponse.attempts).toHaveLength(2);
      expect(tallyResponse.lineError).toBe("second failure");
    });
  });
});
