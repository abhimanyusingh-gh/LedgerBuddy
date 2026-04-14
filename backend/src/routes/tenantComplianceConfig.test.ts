jest.mock("../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../auth/requireCapability.js", () => ({
  requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../models/integration/TenantComplianceConfig.js", () => {
  let store: Record<string, Record<string, unknown>> = {};

  const toObject = (doc: Record<string, unknown>) => ({ ...doc });

  function chainable(resultFn: () => Promise<unknown>) {
    return { lean: () => resultFn() };
  }

  return {
    TenantComplianceConfigModel: {
      findOne: jest.fn((query: { tenantId: string }) => {
        return chainable(async () => {
          const doc = store[query.tenantId];
          return doc ? { ...doc } : null;
        });
      }),
      create: jest.fn(async (data: Record<string, unknown>) => {
        store[data.tenantId as string] = { ...data };
        return { toObject: () => toObject(store[data.tenantId as string]) };
      }),
      findOneAndUpdate: jest.fn(async (
        query: { tenantId: string },
        update: { $set: Record<string, unknown> },
        _opts: unknown
      ) => {
        if (!store[query.tenantId]) {
          store[query.tenantId] = { tenantId: query.tenantId };
        }
        Object.assign(store[query.tenantId], update.$set);
        return { toObject: () => toObject(store[query.tenantId]) };
      }),
      _resetStore: () => { store = {}; }
    }
  };
});

import { defaultAuth, findHandler, mockRequest, mockResponse } from "./testHelpers.ts";
import { TenantComplianceConfigModel } from "../models/integration/TenantComplianceConfig.ts";

let createTenantComplianceConfigRouter: typeof import("./tenantComplianceConfig.ts").createTenantComplianceConfigRouter;

const nextFn = jest.fn();

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../auth/requireAuth.js", () => ({
    requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
  }));
  jest.mock("../auth/requireCapability.js", () => ({
    requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
  }));

  (TenantComplianceConfigModel as unknown as { _resetStore: () => void })._resetStore();
  nextFn.mockClear();

  const mod = await import("./tenantComplianceConfig.ts");
  createTenantComplianceConfigRouter = mod.createTenantComplianceConfigRouter;
});

describe("compliance config routes", () => {
  describe("GET /admin/compliance-config", () => {
    it("returns default config when none exists", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "get", "/admin/compliance-config");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tenantId).toBe("tenant-a");
      expect(body.tdsEnabled).toBe(false);
      expect(Array.isArray(body.tdsRates)).toBe(true);
      expect((body.tdsRates as unknown[]).length).toBe(7);
      expect(Array.isArray(body.activeRiskSignals)).toBe(true);
      expect((body.activeRiskSignals as unknown[]).length).toBeGreaterThan(0);
    });

    it("returns saved config when it exists", async () => {
      const router = createTenantComplianceConfigRouter();
      const getHandler = findHandler(router, "get", "/admin/compliance-config");
      const putHandler = findHandler(router, "put", "/admin/compliance-config");

      const putRes = mockResponse();
      await putHandler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: true, panValidationEnabled: true, panValidationLevel: "format_and_checksum" }
        }),
        putRes,
        nextFn
      );

      const getRes = mockResponse();
      await getHandler(mockRequest({ authContext: defaultAuth }), getRes, nextFn);

      const body = getRes.jsonBody as Record<string, unknown>;
      expect(body.tdsEnabled).toBe(true);
      expect(body.panValidationEnabled).toBe(true);
      expect(body.panValidationLevel).toBe("format_and_checksum");
    });
  });

  describe("PUT /admin/compliance-config", () => {
    it("saves and returns updated config", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsEnabled: true,
            riskSignalsEnabled: true,
            activeRiskSignals: ["PAN_FORMAT_INVALID", "DUPLICATE_INVOICE"]
          }
        }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tdsEnabled).toBe(true);
      expect(body.riskSignalsEnabled).toBe(true);
      expect(body.activeRiskSignals).toEqual(["PAN_FORMAT_INVALID", "DUPLICATE_INVOICE"]);
      expect(body.updatedBy).toBe("admin@test.com");
    });

    it("validates TDS rate range (0-10000 bps)", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsRates: [{
              section: "194C",
              description: "Contractor",
              rateIndividual: 15000,
              rateCompany: 200,
              rateNoPan: 2000,
              threshold: 3000000,
              active: true
            }]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("rateIndividual");
      expect((res.jsonBody as { message: string }).message).toContain("basis points");
    });

    it("validates TDS section format", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsRates: [{
              section: "INVALID",
              description: "Bad section",
              rateIndividual: 100,
              rateCompany: 200,
              rateNoPan: 2000,
              threshold: 3000000,
              active: true
            }]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("not a valid TDS section format");
    });

    it("rejects duplicate TDS sections", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      const entry = {
        section: "194C",
        description: "Contractor",
        rateIndividual: 100,
        rateCompany: 200,
        rateNoPan: 2000,
        threshold: 3000000,
        active: true
      };

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsRates: [entry, entry] }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("Duplicate");
    });

    it("rejects invalid panValidationLevel", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { panValidationLevel: "full_api" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("panValidationLevel");
    });

    it("rejects unknown risk signal codes", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { activeRiskSignals: ["PAN_FORMAT_INVALID", "TOTALLY_FAKE_SIGNAL"] }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("TOTALLY_FAKE_SIGNAL");
    });

    it("accepts valid complete config update", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsEnabled: true,
            tdsRates: [
              { section: "194C", description: "Contractor", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 3000000, active: true },
              { section: "194J", description: "Professional fees", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 3000000, active: true }
            ],
            panValidationEnabled: true,
            panValidationLevel: "format",
            riskSignalsEnabled: true,
            activeRiskSignals: ["PAN_FORMAT_INVALID", "DUPLICATE_INVOICE", "MISSING_IRN"]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tdsEnabled).toBe(true);
      expect((body.tdsRates as unknown[]).length).toBe(2);
      expect(body.panValidationEnabled).toBe(true);
      expect(body.panValidationLevel).toBe("format");
      expect(body.riskSignalsEnabled).toBe(true);
      expect((body.activeRiskSignals as string[]).length).toBe(3);
    });

    it("auto-sets complianceEnabled=true when any feature toggle is enabled", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: true }
        }),
        res,
        nextFn
      );

      const body = res.jsonBody as Record<string, unknown>;
      expect(body.complianceEnabled).toBe(true);
    });

    it("auto-sets complianceEnabled=false when all feature toggles are disabled", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");

      const enableRes = mockResponse();
      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: true, riskSignalsEnabled: true, panValidationEnabled: true }
        }),
        enableRes,
        nextFn
      );
      expect((enableRes.jsonBody as Record<string, unknown>).complianceEnabled).toBe(true);

      const disableRes = mockResponse();
      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: false, riskSignalsEnabled: false, panValidationEnabled: false }
        }),
        disableRes,
        nextFn
      );
      expect((disableRes.jsonBody as Record<string, unknown>).complianceEnabled).toBe(false);
    });

    it("keeps complianceEnabled=true when disabling one toggle but others remain on", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");

      const enableRes = mockResponse();
      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: true, riskSignalsEnabled: true }
        }),
        enableRes,
        nextFn
      );

      const partialRes = mockResponse();
      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { tdsEnabled: false }
        }),
        partialRes,
        nextFn
      );
      expect((partialRes.jsonBody as Record<string, unknown>).complianceEnabled).toBe(true);
    });

    it("validates negative threshold is rejected", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsRates: [{
              section: "194C",
              description: "Contractor",
              rateIndividual: 100,
              rateCompany: 200,
              rateNoPan: 2000,
              threshold: -1,
              active: true
            }]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("threshold");
    });
  });

  describe("GET /compliance/tds-sections", () => {
    it("returns default TDS sections", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "get", "/compliance/tds-sections");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as { items: unknown[] };
      expect(body.items.length).toBe(7);
      const first = body.items[0] as Record<string, unknown>;
      expect(first.section).toBe("194C");
      expect(first.rateIndividual).toBe(100);
      expect(first.rateCompany).toBe(200);
      expect(first.rateNoPan).toBe(2000);
      expect(first.threshold).toBe(3000000);
    });
  });

  describe("GET /compliance/risk-signals", () => {
    it("returns available risk signals", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "get", "/compliance/risk-signals");
      const res = mockResponse();

      await handler(mockRequest({ authContext: defaultAuth }), res, nextFn);

      const body = res.jsonBody as { items: Array<{ code: string; description: string; category: string }> };
      expect(body.items.length).toBeGreaterThan(5);
      const codes = body.items.map((s) => s.code);
      expect(codes).toContain("PAN_FORMAT_INVALID");
      expect(codes).toContain("DUPLICATE_INVOICE");
      expect(codes).toContain("MISSING_IRN");
    });
  });
});
