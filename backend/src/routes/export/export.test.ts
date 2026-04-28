import { Types } from "mongoose";
import { createExportRouter } from "@/routes/export/export.ts";
import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import {
  ExportBatchNotFoundError,
  ExportRetryNoFailuresError,
  type ExportService
} from "@/services/export/exportService.ts";

const TEST_CLIENT_ORG_ID = new Types.ObjectId("0123456789abcdef01234567");
const authWithClientOrg = { authContext: defaultAuth, activeClientOrgId: TEST_CLIENT_ORG_ID };

function createMockExportService(overrides?: Partial<ExportService>): ExportService {
  return {
    canGenerateFiles: true,
    exportApprovedInvoices: jest.fn(async () => ({
      batchId: "batch-1",
      total: 0,
      successCount: 0,
      failureCount: 0,
      items: []
    })),
    generateExportFile: jest.fn(async () => ({
      batchId: "batch-1",
      fileKey: "tally-exports/tenant-a/batch.xml",
      filename: "batch.xml",
      total: 3,
      includedCount: 3,
      skippedCount: 0,
      skippedItems: []
    })),
    downloadExportFile: jest.fn(async () => null),
    listExportHistory: jest.fn(async () => ({
      items: [],
      page: 1,
      limit: 20,
      total: 0
    })),
    retryFailedItems: jest.fn(async () => ({
      batchId: "batch-1",
      retriedCount: 1,
      total: 2,
      successCount: 2,
      failureCount: 0,
      items: []
    })),
    ...overrides
  } as unknown as ExportService;
}

describe("export routes", () => {
  describe("GET /exports/tally/history", () => {
    it("returns 400 when export service is null", async () => {
      const router = createExportRouter(null);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest(authWithClientOrg), res, next);

      expect(res.statusCode).toBe(400);
    });

    it("returns paginated history with default params", async () => {
      const mockService = createMockExportService({
        listExportHistory: jest.fn(async () => ({
          items: [
            {
              batchId: "batch-1",
              system: "tally",
              total: 5,
              successCount: 4,
              failureCount: 1,
              requestedBy: "admin@test.com",
              hasFile: true,
              createdAt: new Date("2026-03-01"),
              updatedAt: new Date("2026-03-01")
            }
          ],
          page: 1,
          limit: 20,
          total: 1
        }))
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest(authWithClientOrg), res, jest.fn());

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { items: unknown[]; total: number };
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(mockService.listExportHistory).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        clientOrgId: TEST_CLIENT_ORG_ID,
        page: 1,
        limit: 20
      });
    });

    it("accepts custom page and limit query parameters", async () => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, query: { page: "3", limit: "50" } }), res, jest.fn());

      expect(mockService.listExportHistory).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        clientOrgId: TEST_CLIENT_ORG_ID,
        page: 3,
        limit: 50
      });
    });

    it.each([
      ["clamps limit to max 100", { limit: "999" }, { limit: 100 }],
      ["clamps page to min 1", { page: "-5" }, { page: 1 }],
    ])("%s", async (_label, query, expected) => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, query }), res, jest.fn());

      expect(mockService.listExportHistory).toHaveBeenCalledWith(
        expect.objectContaining(expected)
      );
    });

    it("calls next with error when service throws", async () => {
      const thrownError = new Error("MongoDB connection failed");
      const mockService = createMockExportService({
        listExportHistory: jest.fn(async () => { throw thrownError; })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest(authWithClientOrg), res, next);

      expect(next).toHaveBeenCalledWith(thrownError);
    });
  });

  describe("GET /exports/tally/download/:batchId", () => {
    it("returns 404 when downloadExportFile returns null", async () => {
      const mockService = createMockExportService({
        downloadExportFile: jest.fn(async () => null)
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "batch-123" } }), res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("returns file with correct content type and disposition headers", async () => {
      const mockService = createMockExportService({
        downloadExportFile: jest.fn(async () => ({
          body: Buffer.from("<xml>export</xml>"),
          contentType: "text/xml",
          filename: "tally-batch.xml"
        }))
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "batch-1" } }), res, jest.fn());

      expect((res.headers as Record<string, string>)["content-type"]).toBe("text/xml");
      expect((res.headers as Record<string, string>)["content-disposition"]).toContain("tally-batch.xml");
    });

    it("returns 503 when canGenerateFiles is false", async () => {
      const mockService = createMockExportService({ canGenerateFiles: false } as Partial<ExportService>);
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "batch-1" } }), res, jest.fn());

      expect(res.statusCode).toBe(503);
      expect((res.jsonBody as { message: string }).message).toContain("File store is not configured");
    });

    it("calls next with error when downloadExportFile throws", async () => {
      const thrownError = new Error("S3 GetObject failed: NoSuchKey");
      const mockService = createMockExportService({
        downloadExportFile: jest.fn(async () => { throw thrownError; })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "batch-1" } }), res, next);

      expect(next).toHaveBeenCalledWith(thrownError);
    });
  });

  describe("POST /exports/tally/batches/:batchId/retry", () => {
    it("returns 400 when export service is null", async () => {
      const router = createExportRouter(null);
      const handler = findHandler(router, "post", "/exports/tally/batches/:batchId/retry");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "b1" }, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when batch is not found", async () => {
      const mockService = createMockExportService({
        retryFailedItems: jest.fn(async () => { throw new ExportBatchNotFoundError("missing"); })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/batches/:batchId/retry");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "missing" }, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("returns 409 when batch has no failure items to retry", async () => {
      const mockService = createMockExportService({
        retryFailedItems: jest.fn(async () => { throw new ExportRetryNoFailuresError("b1"); })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/batches/:batchId/retry");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "b1" }, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(409);
    });

    it("delegates invoiceIds + paymentIds filter to service and returns 200 on success", async () => {
      const retrySpy = jest.fn(async () => ({
        batchId: "b1",
        retriedCount: 1,
        total: 2,
        successCount: 2,
        failureCount: 0,
        items: []
      }));
      const mockService = createMockExportService({ retryFailedItems: retrySpy });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/batches/:batchId/retry");
      const res = mockResponse();

      await handler(
        mockRequest({
          ...authWithClientOrg,
          params: { batchId: "b1" },
          body: { invoiceIds: ["inv-1"], paymentIds: ["pay-1"] }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(retrySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          batchId: "b1",
          invoiceIds: ["inv-1"],
          paymentIds: ["pay-1"],
          tenantId: "tenant-a",
          clientOrgId: TEST_CLIENT_ORG_ID
        })
      );
    });

    it("calls next with error on unexpected service failure", async () => {
      const thrownError = new Error("boom");
      const mockService = createMockExportService({
        retryFailedItems: jest.fn(async () => { throw thrownError; })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/batches/:batchId/retry");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest({ ...authWithClientOrg, params: { batchId: "b1" }, body: {} }), res, next);

      expect(next).toHaveBeenCalledWith(thrownError);
    });
  });

  describe("POST /exports/tally", () => {
    it("calls next with error when exportApprovedInvoices throws", async () => {
      const thrownError = new Error("Connection timed out");
      const mockService = createMockExportService({
        exportApprovedInvoices: jest.fn(async () => { throw thrownError; })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, next);

      expect(next).toHaveBeenCalledWith(thrownError);
    });
  });

  describe("POST /exports/tally/download", () => {
    it("returns 404 when no approved invoices found", async () => {
      const mockService = createMockExportService({
        generateExportFile: jest.fn(async () => ({
          batchId: undefined,
          fileKey: undefined,
          filename: undefined,
          total: 0,
          includedCount: 0,
          skippedCount: 0,
          skippedItems: []
        }))
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("returns export result when invoices are exported successfully", async () => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as { batchId: string }).batchId).toBe("batch-1");
    });

    it("returns 503 when canGenerateFiles is false", async () => {
      const mockService = createMockExportService({ canGenerateFiles: false } as Partial<ExportService>);
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(503);
      expect((res.jsonBody as { message: string }).message).toContain("File store is not configured");
    });

    it("calls next with error when generateExportFile throws", async () => {
      const thrownError = new Error("File store is required for export file generation.");
      const mockService = createMockExportService({
        generateExportFile: jest.fn(async () => { throw thrownError; })
      });
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, next);

      expect(next).toHaveBeenCalledWith(thrownError);
    });

    it("returns 400 when export service is null", async () => {
      const router = createExportRouter(null);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();

      await handler(mockRequest({ ...authWithClientOrg, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(400);
    });
  });
});
