import { Types } from "mongoose";
import { ExportService } from "@/services/export/exportService.ts";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.ts";
import { InvoiceModel } from "@/models/invoice/Invoice.ts";
import type { AccountingExporter } from "@/core/interfaces/AccountingExporter.ts";
import type { FileStore } from "@/core/interfaces/FileStore.ts";

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
      const result = await service.listExportHistory({ tenantId: "tenant-a", page: 1, limit: 20 });

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("returns paginated results with hasFile mapping", async () => {
      const batchId = new Types.ObjectId();
      const mockBatch = {
        _id: batchId,
        tenantId: "tenant-a",
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
      const result = await service.listExportHistory({ tenantId: "tenant-a", page: 1, limit: 20 });

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
        tenantId: "tenant-a",
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
      const result = await service.listExportHistory({ tenantId: "tenant-a", page: 1, limit: 20 });

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
      await service.listExportHistory({ tenantId: "tenant-a", page: 2, limit: 10 });

      const chain = findSpy.mock.results[0].value;
      expect(chain.skip).toHaveBeenCalledWith(10);
      expect(chain.limit).toHaveBeenCalledWith(10);
    });

    it("filters by tenantId in both find and countDocuments", async () => {
      const findSpy = jest.spyOn(ExportBatchModel, "find").mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([])
      } as never);
      const countSpy = jest.spyOn(ExportBatchModel, "countDocuments").mockResolvedValue(0 as never);

      const service = new ExportService(createMockExporter());
      await service.listExportHistory({ tenantId: "tenant-x", page: 1, limit: 20 });

      expect(findSpy).toHaveBeenCalledWith({ tenantId: "tenant-x" });
      expect(countSpy).toHaveBeenCalledWith({ tenantId: "tenant-x" });
    });
  });

  describe("downloadExportFile", () => {
    it("returns null when batch is not found", async () => {
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(null as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      const result = await service.downloadExportFile("nonexistent-id");

      expect(result).toBeNull();
    });

    it("returns file content when batch exists with fileKey", async () => {
      const mockBatch = { fileKey: "tally-exports/tenant-a/batch.xml" };
      jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(mockBatch as never);

      const fileStore = createMockFileStore();
      const service = new ExportService(createMockExporter(), fileStore);
      const result = await service.downloadExportFile("batch-id-123");

      expect(result).not.toBeNull();
      expect(result!.filename).toBe("batch.xml");
      expect(fileStore.getObject).toHaveBeenCalledWith("tally-exports/tenant-a/batch.xml");
    });

    it("scopes download query by tenantId when provided", async () => {
      const findOneSpy = jest.spyOn(ExportBatchModel, "findOne").mockResolvedValue(null as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      await service.downloadExportFile("batch-123", "tenant-a");

      expect(findOneSpy).toHaveBeenCalledWith({ _id: "batch-123", tenantId: "tenant-a" });
    });

    it("throws when file store is not configured", async () => {
      const service = new ExportService(createMockExporter());
      await expect(service.downloadExportFile("batch-123")).rejects.toThrow(
        "File store is required for export file retrieval."
      );
    });
  });

  describe("generateExportFile", () => {
    it("passes tenantId to ExportBatchModel.create", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([
          { _id: new Types.ObjectId(), status: "APPROVED" }
        ])
      } as never);
      jest.spyOn(InvoiceModel, "bulkWrite").mockResolvedValue({} as never);

      const createSpy = jest.spyOn(ExportBatchModel, "create").mockResolvedValue({
        _id: new Types.ObjectId()
      } as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      await service.generateExportFile({
        requestedBy: "admin@test.com",
        tenantId: "tenant-b"
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-b" })
      );
    });

    it("returns empty result when no approved invoices exist", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({ select: jest.fn().mockResolvedValue([]) } as never);

      const service = new ExportService(createMockExporter(), createMockFileStore());
      const result = await service.generateExportFile({
        requestedBy: "admin@test.com",
        tenantId: "tenant-a"
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
        tenantId: "tenant-c"
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
    it("passes tenantId to ExportBatchModel.create", async () => {
      const mockInvoice = {
        _id: new Types.ObjectId(),
        status: "APPROVED"
      };
      jest.spyOn(InvoiceModel, "find").mockReturnValue({
        select: jest.fn().mockResolvedValue([mockInvoice])
      } as never);
      jest.spyOn(InvoiceModel, "updateOne").mockResolvedValue({} as never);

      const exporter = createMockExporter({
        exportInvoices: jest.fn(async () => [
          { invoiceId: String(mockInvoice._id), success: true, externalReference: "ref-1" }
        ])
      });
      const createSpy = jest.spyOn(ExportBatchModel, "create").mockResolvedValue({
        _id: new Types.ObjectId()
      } as never);

      const service = new ExportService(exporter);
      await service.exportApprovedInvoices({
        requestedBy: "admin@test.com",
        tenantId: "tenant-d"
      });

      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-d" })
      );
    });

    it("returns zero totals when no approved invoices exist", async () => {
      jest.spyOn(InvoiceModel, "find").mockReturnValue({ select: jest.fn().mockResolvedValue([]) } as never);

      const service = new ExportService(createMockExporter());
      const result = await service.exportApprovedInvoices({
        requestedBy: "admin@test.com",
        tenantId: "tenant-a"
      });

      expect(result.total).toBe(0);
      expect(result.batchId).toBeUndefined();
    });
  });
});
