import { createTenantExportConfigRouter } from "@/routes/export/tenantExportConfig.ts";
import { TenantExportConfigModel } from "@/models/integration/TenantExportConfig.ts";
import { defaultAuth, findHandler, hasMiddleware, mockRequest, mockResponse } from "@/routes/testHelpers.ts";

describe("tenantExportConfig routes", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("applies requireAuth middleware", () => {
    const router = createTenantExportConfigRouter();
    expect(hasMiddleware(router, "requireAuth")).toBe(true);
  });

  describe("GET /tenant/:tenantId/export-config", () => {
    it("returns empty object when no config exists", async () => {
      jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      } as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "get", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, params: { tenantId: "tenant-a" } }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(res.jsonBody).toEqual({});
    });

    it("returns existing config", async () => {
      const existing = {
        tenantId: "tenant-a",
        tallyCompanyName: "My Company",
        tallyCgstLedger: "Custom CGST"
      };
      jest.spyOn(TenantExportConfigModel, "findOne").mockReturnValue({
        lean: jest.fn().mockResolvedValue(existing)
      } as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "get", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, params: { tenantId: "tenant-a" } }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(res.jsonBody).toEqual(existing);
    });

    it("returns 403 when tenantId does not match auth context", async () => {
      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "get", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, params: { tenantId: "other-tenant" } }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /tenant/:tenantId/export-config", () => {
    it("upserts config with valid tally fields", async () => {
      const saved = {
        tenantId: "tenant-a",
        tallyCompanyName: "Updated Company",
        toObject: () => ({ tenantId: "tenant-a", tallyCompanyName: "Updated Company" })
      };
      jest.spyOn(TenantExportConfigModel, "findOneAndUpdate").mockResolvedValue(saved as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { tallyCompanyName: "Updated Company" }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(TenantExportConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tenantId: "tenant-a" },
        { $set: expect.objectContaining({ tallyCompanyName: "Updated Company" }) },
        expect.objectContaining({ upsert: true })
      );
    });

    it("validates csvColumns entries", async () => {
      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { csvColumns: [{ key: "invalidKey", label: "Bad" }] }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("invalidKey");
    });

    it("accepts valid csvColumns", async () => {
      const saved = {
        toObject: () => ({
          tenantId: "tenant-a",
          csvColumns: [{ key: "invoiceNumber", label: "Inv #" }]
        })
      };
      jest.spyOn(TenantExportConfigModel, "findOneAndUpdate").mockResolvedValue(saved as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { csvColumns: [{ key: "invoiceNumber", label: "Inv #" }] }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
    });

    it("clears csvColumns when set to null", async () => {
      const saved = {
        toObject: () => ({ tenantId: "tenant-a", csvColumns: [] })
      };
      jest.spyOn(TenantExportConfigModel, "findOneAndUpdate").mockResolvedValue(saved as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { csvColumns: null }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(TenantExportConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tenantId: "tenant-a" },
        { $set: expect.objectContaining({ csvColumns: [] }) },
        expect.anything()
      );
    });

    it("clears a tally field when set to null", async () => {
      const saved = {
        toObject: () => ({ tenantId: "tenant-a" })
      };
      jest.spyOn(TenantExportConfigModel, "findOneAndUpdate").mockResolvedValue(saved as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { tallyCompanyName: null }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect(TenantExportConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tenantId: "tenant-a" },
        { $set: expect.objectContaining({ tallyCompanyName: undefined }) },
        expect.anything()
      );
    });

    it("returns 400 when no valid fields provided", async () => {
      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: {}
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(400);
    });

    it("returns 403 when tenantId does not match auth context", async () => {
      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "other-tenant" },
          body: { tallyCompanyName: "Hijack" }
        }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(403);
    });

    it("calls next with error when findOneAndUpdate throws", async () => {
      const thrownError = new Error("MongoDB failure");
      jest.spyOn(TenantExportConfigModel, "findOneAndUpdate").mockRejectedValue(thrownError as never);

      const router = createTenantExportConfigRouter();
      const handler = findHandler(router, "patch", "/tenant/:tenantId/export-config");
      const res = mockResponse();
      const next = jest.fn();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          params: { tenantId: "tenant-a" },
          body: { tallyCompanyName: "Test" }
        }),
        res,
        next
      );

      expect(next).toHaveBeenCalledWith(thrownError);
    });
  });
});
