import { createTcsConfigRouter, requireTcsModifyAccess } from "@/routes/compliance/tcsConfig.ts";
import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.ts";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.ts";
import { requireCap } from "@/auth/requireCapability.ts";

jest.mock("../../models/integration/TenantTcsConfig.ts");
jest.mock("../../models/integration/TenantComplianceConfig.ts", () => ({
  TenantComplianceConfigModel: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      })
    }))
  }
}));
jest.mock("../../models/core/TenantUserRole.ts", () => {
  const actual = jest.requireActual("../../models/core/TenantUserRole.ts");
  return {
    ...actual,
    TenantUserRoleModel: {
      findOne: jest.fn()
    }
  };
});

describe("tcsConfig routes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    });
  });

  describe("GET /admin/tcs-config", () => {
    it("creates and returns default config when none exists", async () => {
      (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      });
      const created = {
        tenantId: "tenant-a",
        ratePercent: 0,
        toObject: () => ({ tenantId: "tenant-a", ratePercent: 0 })
      };
      (TenantTcsConfigModel.create as jest.Mock).mockResolvedValue(created);

      const router = createTcsConfigRouter();
      const handler = findHandler(router, "get", "/admin/tcs-config");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect(TenantTcsConfigModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-a" })
      );
      expect(res.statusCode).toBe(200);
    });

    it("returns existing config when found", async () => {
      const existing = { tenantId: "tenant-a", ratePercent: 2, enabled: true, history: [] };
      (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(existing)
      });

      const router = createTcsConfigRouter();
      const handler = findHandler(router, "get", "/admin/tcs-config");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, jest.fn());

      expect(TenantTcsConfigModel.create).not.toHaveBeenCalled();
      expect((res.jsonBody as { ratePercent: number }).ratePercent).toBe(2);
    });
  });

  describe("PUT /admin/tcs-config", () => {
    it.each([
      ["negative", -1],
      ["above 100", 101],
    ])("returns 400 when ratePercent is %s", async (_label, ratePercent) => {
      const router = createTcsConfigRouter();
      const handler = findHandler(router, "put", "/admin/tcs-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { ratePercent, effectiveFrom: "2026-01-01", enabled: true } }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("ratePercent");
    });

    it("prepends history entry on valid update", async () => {
      const existing = { tenantId: "tenant-a", ratePercent: 1, effectiveFrom: "2025-01-01", enabled: true };
      (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue(existing)
      });
      const updatedDoc = {
        tenantId: "tenant-a",
        ratePercent: 2,
        history: [{ previousRate: 1, newRate: 2 }],
        toObject: () => ({ tenantId: "tenant-a", ratePercent: 2, history: [{ previousRate: 1, newRate: 2 }] })
      };
      (TenantTcsConfigModel.findOneAndUpdate as jest.Mock).mockResolvedValue(updatedDoc);

      const router = createTcsConfigRouter();
      const handler = findHandler(router, "put", "/admin/tcs-config");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { ratePercent: 2, effectiveFrom: "2026-01-01", enabled: true, reason: "Budget change" } }),
        res,
        jest.fn()
      );

      expect(TenantTcsConfigModel.findOneAndUpdate).toHaveBeenCalledWith(
        { tenantId: "tenant-a" },
        expect.objectContaining({
          $push: expect.objectContaining({
            history: expect.objectContaining({ $position: 0 })
          })
        }),
        expect.any(Object)
      );
      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as { ratePercent: number; history: unknown[] };
      expect(body.ratePercent).toBe(2);
      expect(body.history).toHaveLength(1);
    });
  });

  describe("PUT /admin/tcs-config/roles", () => {
    it("returns 403 when canConfigureCompliance capability is not granted", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          role: "ap_clerk",
          capabilities: { canConfigureCompliance: false }
        })
      });

      const cap = requireCap("canConfigureCompliance");
      const req = mockRequest({ authContext: { ...defaultAuth, role: "ap_clerk" } });
      const res = mockResponse();
      const next = jest.fn();

      await cap(req as never, res as never, next);

      expect(res.statusCode).toBe(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("updates tcsModifyRoles when user has canConfigureCompliance", async () => {
      (TenantUserRoleModel.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({
          role: "TENANT_ADMIN",
          capabilities: { canConfigureCompliance: true }
        })
      });
      const updatedDoc = {
        tenantId: "tenant-a",
        tcsModifyRoles: ["TENANT_ADMIN"],
        toObject: () => ({ tenantId: "tenant-a", tcsModifyRoles: ["TENANT_ADMIN"] })
      };
      (TenantTcsConfigModel.findOneAndUpdate as jest.Mock).mockResolvedValue(updatedDoc);

      const router = createTcsConfigRouter();
      const handler = findHandler(router, "put", "/admin/tcs-config/roles");
      const res = mockResponse();

      await handler(
        mockRequest({ authContext: defaultAuth, body: { tcsModifyRoles: ["TENANT_ADMIN"] } }),
        res,
        jest.fn()
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as { tcsModifyRoles: string[] }).tcsModifyRoles).toEqual(["TENANT_ADMIN"]);
    });
  });
});

describe("requireTcsModifyAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("blocks role not in tcsModifyRoles with 403", async () => {
    (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ tcsModifyRoles: ["TENANT_ADMIN"] })
    });

    const req = mockRequest({ authContext: { ...defaultAuth, role: "ap_clerk" } });
    const res = mockResponse();
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      const originalJson = (res as Record<string, unknown>).json as (body: unknown) => unknown;
      (res as Record<string, unknown>).json = (body: unknown) => {
        const result = originalJson(body);
        resolve();
        return result;
      };
      requireTcsModifyAccess(req as never, res as never, next);
    });

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when role is in tcsModifyRoles", async () => {
    (TenantTcsConfigModel.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ tcsModifyRoles: ["TENANT_ADMIN", "senior_accountant"] })
    });

    const req = mockRequest({ authContext: { ...defaultAuth, role: "senior_accountant" } });
    const res = mockResponse();
    const next = jest.fn();

    await new Promise<void>((resolve) => {
      next.mockImplementation(() => resolve());
      requireTcsModifyAccess(req as never, res as never, next);
    });

    expect(next).toHaveBeenCalledTimes(1);
  });
});
