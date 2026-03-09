import { createExportRouter } from "./export.ts";
import type { ExportService } from "../services/exportService.ts";

function createMockExportService(overrides?: Partial<ExportService>): ExportService {
  return {
    exportApprovedInvoices: jest.fn(),
    generateExportFile: jest.fn(),
    downloadExportFile: jest.fn(),
    listExportHistory: jest.fn(async () => ({
      items: [],
      page: 1,
      limit: 20,
      total: 0
    })),
    ...overrides
  } as unknown as ExportService;
}

const defaultAuth = {
  userId: "user-1",
  email: "admin@test.com",
  tenantId: "tenant-a",
  tenantName: "Test Tenant",
  role: "TENANT_ADMIN",
  isPlatformAdmin: false
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findHandler(router: any, method: string, path: string): Function {
  for (const layer of router.stack) {
    if (layer.route?.path === path && layer.route.methods[method]) {
      return layer.route.stack[0].handle;
    }
  }
  throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
}

function mockRequest(overrides: Record<string, unknown> = {}) {
  return {
    authContext: null,
    query: {},
    params: {},
    body: {},
    ...overrides
  };
}

function mockResponse() {
  const res: Record<string, unknown> = {
    statusCode: 200,
    jsonBody: undefined as unknown,
    headers: {} as Record<string, string>,
    sentBody: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(data: unknown) {
      res.jsonBody = data;
      return res;
    },
    setHeader(name: string, value: string) {
      (res.headers as Record<string, string>)[name.toLowerCase()] = value;
      return res;
    },
    send(body: unknown) {
      res.sentBody = body;
      return res;
    }
  };
  return res;
}

describe("export routes", () => {
  describe("GET /exports/tally/history", () => {
    it("returns 401 when no auth context", async () => {
      const router = createExportRouter(createMockExportService());
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest(), res, next);

      expect(res.statusCode).toBe(401);
      expect((res.jsonBody as { message: string }).message).toBe("Authentication required.");
    });

    it("returns 400 when export service is null", async () => {
      const router = createExportRouter(null);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();
      const next = jest.fn();

      await handler(mockRequest({ authContext: defaultAuth }), res, next);

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

      await handler(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { items: unknown[]; total: number };
      expect(body.items).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(mockService.listExportHistory).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        page: 1,
        limit: 20
      });
    });

    it("accepts custom page and limit query parameters", async () => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, query: { page: "3", limit: "50" } }), res, jest.fn());

      expect(mockService.listExportHistory).toHaveBeenCalledWith({
        tenantId: "tenant-a",
        page: 3,
        limit: 50
      });
    });

    it("clamps limit to max 100", async () => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, query: { limit: "999" } }), res, jest.fn());

      expect(mockService.listExportHistory).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 100 })
      );
    });

    it("clamps page to min 1", async () => {
      const mockService = createMockExportService();
      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/history");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, query: { page: "-5" } }), res, jest.fn());

      expect(mockService.listExportHistory).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1 })
      );
    });
  });

  describe("GET /exports/tally/download/:batchId", () => {
    it("returns 401 when no auth context", async () => {
      const router = createExportRouter(createMockExportService());
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();

      await handler(mockRequest({ params: { batchId: "batch-123" } }), res, jest.fn());

      expect(res.statusCode).toBe(401);
    });

    it("passes tenantId to downloadExportFile for tenant-scoped access", async () => {
      const mockService = createMockExportService({
        downloadExportFile: jest.fn(async () => null)
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "get", "/exports/tally/download/:batchId");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, params: { batchId: "batch-123" } }), res, jest.fn());

      expect(mockService.downloadExportFile).toHaveBeenCalledWith("batch-123", "tenant-a");
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

      await handler(mockRequest({ authContext: defaultAuth, params: { batchId: "batch-1" } }), res, jest.fn());

      expect((res.headers as Record<string, string>)["content-type"]).toBe("text/xml");
      expect((res.headers as Record<string, string>)["content-disposition"]).toContain("tally-batch.xml");
    });
  });

  describe("POST /exports/tally", () => {
    it("returns 401 when no auth context", async () => {
      const router = createExportRouter(createMockExportService());
      const handler = findHandler(router, "post", "/exports/tally");
      const res = mockResponse();

      await handler(mockRequest(), res, jest.fn());

      expect(res.statusCode).toBe(401);
    });

    it("passes tenantId from auth context to export service", async () => {
      const mockService = createMockExportService({
        exportApprovedInvoices: jest.fn(async () => ({
          batchId: "batch-1",
          total: 0,
          successCount: 0,
          failureCount: 0,
          items: []
        }))
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, body: { requestedBy: "ui" } }), res, jest.fn());

      expect(mockService.exportApprovedInvoices).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-a", requestedBy: "ui" })
      );
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

      await handler(mockRequest({ authContext: defaultAuth, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(404);
    });

    it("returns export result when invoices are exported successfully", async () => {
      const mockService = createMockExportService({
        generateExportFile: jest.fn(async () => ({
          batchId: "batch-1",
          fileKey: "tally-exports/tenant-a/batch.xml",
          filename: "batch.xml",
          total: 3,
          includedCount: 3,
          skippedCount: 0,
          skippedItems: []
        }))
      });

      const router = createExportRouter(mockService);
      const handler = findHandler(router, "post", "/exports/tally/download");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth, body: {} }), res, jest.fn());

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as { batchId: string }).batchId).toBe("batch-1");
    });
  });
});
