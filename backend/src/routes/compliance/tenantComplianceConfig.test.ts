jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../../auth/requireCapability.js", () => ({
  requireCap: () => (_req: unknown, _res: unknown, next: Function) => next()
}));

jest.mock("../../models/integration/TenantComplianceConfig.js", () => {
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

import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig.ts";

let createTenantComplianceConfigRouter: typeof import("./tenantComplianceConfig.ts").createTenantComplianceConfigRouter;

const nextFn = jest.fn();

beforeEach(async () => {
  jest.resetModules();

  jest.mock("../../auth/requireAuth.js", () => ({
    requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
  }));
  jest.mock("../../auth/requireCapability.js", () => ({
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

  describe("PUT /admin/compliance-config — new configurable fields", () => {
    it("accepts all new numeric fields with valid values", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            maxInvoiceTotalMinor: 100000000,
            maxDueDays: 180,
            autoApprovalThreshold: 85,
            eInvoiceThresholdMinor: 500000000,
            msmePaymentWarningDays: 30,
            msmePaymentOverdueDays: 45,
            minimumExpectedTotalMinor: 10000,
            riskSignalPenaltyCap: 30,
            ocrWeight: 0.65,
            completenessWeight: 0.35,
            warningPenalty: 4,
            warningPenaltyCap: 25,
            reconciliationAutoMatchThreshold: 50,
            reconciliationSuggestThreshold: 30,
            reconciliationAmountToleranceMinor: 100,
            invoiceDateWindowDays: 1460,
            defaultCurrency: "INR"
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.maxInvoiceTotalMinor).toBe(100000000);
      expect(body.maxDueDays).toBe(180);
      expect(body.autoApprovalThreshold).toBe(85);
      expect(body.eInvoiceThresholdMinor).toBe(500000000);
      expect(body.msmePaymentWarningDays).toBe(30);
      expect(body.msmePaymentOverdueDays).toBe(45);
      expect(body.minimumExpectedTotalMinor).toBe(10000);
      expect(body.riskSignalPenaltyCap).toBe(30);
      expect(body.ocrWeight).toBe(0.65);
      expect(body.completenessWeight).toBe(0.35);
      expect(body.warningPenalty).toBe(4);
      expect(body.warningPenaltyCap).toBe(25);
      expect(body.reconciliationAutoMatchThreshold).toBe(50);
      expect(body.reconciliationSuggestThreshold).toBe(30);
      expect(body.reconciliationAmountToleranceMinor).toBe(100);
      expect(body.invoiceDateWindowDays).toBe(1460);
      expect(body.defaultCurrency).toBe("INR");
    });

    it("accepts requiredFields array", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            requiredFields: ["invoiceNumber", "vendorName", "totalAmount", "invoiceDate"]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).requiredFields).toEqual([
        "invoiceNumber", "vendorName", "totalAmount", "invoiceDate"
      ]);
    });

    it("accepts confidencePenaltyOverrides map", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            confidencePenaltyOverrides: {
              DUPLICATE_INVOICE: 15,
              PAN_FORMAT_INVALID: 10
            }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const overrides = (res.jsonBody as Record<string, unknown>).confidencePenaltyOverrides as Record<string, number>;
      expect(overrides.DUPLICATE_INVOICE).toBe(15);
      expect(overrides.PAN_FORMAT_INVALID).toBe(10);
    });

    it("rejects autoApprovalThreshold above 100", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { autoApprovalThreshold: 101 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("autoApprovalThreshold");
    });

    it("rejects negative autoApprovalThreshold", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { autoApprovalThreshold: -1 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("autoApprovalThreshold");
    });

    it("rejects ocrWeight above 1", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 1.5 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("ocrWeight");
    });

    it("rejects negative ocrWeight", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: -0.1 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("ocrWeight");
    });

    it("rejects completenessWeight above 1", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { completenessWeight: 2 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("completenessWeight");
    });

    it("rejects maxDueDays of 0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { maxDueDays: 0 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("maxDueDays");
    });

    it("rejects maxDueDays above 3650", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { maxDueDays: 4000 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("maxDueDays");
    });

    it("rejects non-integer maxInvoiceTotalMinor", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { maxInvoiceTotalMinor: 99.5 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("maxInvoiceTotalMinor");
    });

    it("rejects negative maxInvoiceTotalMinor", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { maxInvoiceTotalMinor: -100 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("maxInvoiceTotalMinor");
    });

    it("rejects invalid defaultCurrency (lowercase)", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { defaultCurrency: "inr" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("defaultCurrency");
    });

    it("rejects invalid defaultCurrency (wrong length)", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { defaultCurrency: "US" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("defaultCurrency");
    });

    it("rejects confidencePenaltyOverrides with value above 100", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            confidencePenaltyOverrides: { DUPLICATE_INVOICE: 150 }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });

    it("rejects warningPenalty above 100", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { warningPenalty: 101 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("warningPenalty");
    });

    it("rejects invoiceDateWindowDays of 0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { invoiceDateWindowDays: 0 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("invoiceDateWindowDays");
    });

    it("rejects invoiceDateWindowDays above 7300", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { invoiceDateWindowDays: 8000 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("invoiceDateWindowDays");
    });

    it("rejects reconciliationAutoMatchThreshold above 100", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { reconciliationAutoMatchThreshold: 200 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("reconciliationAutoMatchThreshold");
    });

    it("does not persist new fields when omitted", async () => {
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

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.maxInvoiceTotalMinor).toBeUndefined();
      expect(body.ocrWeight).toBeUndefined();
      expect(body.requiredFields).toBeUndefined();
      expect(body.defaultCurrency).toBeUndefined();
    });

    it("accepts boundary value ocrWeight=0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 0 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).ocrWeight).toBe(0);
    });

    it("accepts boundary value ocrWeight=1", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 1 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).ocrWeight).toBe(1);
    });

    it("accepts maxInvoiceTotalMinor=0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { maxInvoiceTotalMinor: 0 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).maxInvoiceTotalMinor).toBe(0);
    });

    it("mixes new fields with existing config fields", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            tdsEnabled: true,
            riskSignalsEnabled: true,
            maxInvoiceTotalMinor: 50000000,
            ocrWeight: 0.7,
            defaultCurrency: "USD",
            requiredFields: ["invoiceNumber", "totalAmount"]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.tdsEnabled).toBe(true);
      expect(body.riskSignalsEnabled).toBe(true);
      expect(body.maxInvoiceTotalMinor).toBe(50000000);
      expect(body.ocrWeight).toBe(0.7);
      expect(body.defaultCurrency).toBe("USD");
      expect(body.requiredFields).toEqual(["invoiceNumber", "totalAmount"]);
      expect(body.complianceEnabled).toBe(true);
    });

    it("rejects requiredFields with empty strings", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { requiredFields: ["invoiceNumber", ""] }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("requiredFields");
    });

    it("rejects negative confidencePenaltyOverrides value", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            confidencePenaltyOverrides: { DUPLICATE_INVOICE: -5 }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });

    it("rejects msmePaymentWarningDays of 0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { msmePaymentWarningDays: 0 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("msmePaymentWarningDays");
    });

    it("rejects msmePaymentOverdueDays above 365", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { msmePaymentOverdueDays: 400 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("msmePaymentOverdueDays");
    });

    it("rejects riskSignalPenaltyCap above 100", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { riskSignalPenaltyCap: 150 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("riskSignalPenaltyCap");
    });
  });

  describe("PUT /admin/compliance-config — approval limit overrides", () => {
    it("accepts valid approvalLimitOverrides map", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            approvalLimitOverrides: {
              ap_clerk: 20000000,
              senior_accountant: 200000000
            }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      const overrides = body.approvalLimitOverrides as Record<string, number>;
      expect(overrides.ap_clerk).toBe(20000000);
      expect(overrides.senior_accountant).toBe(200000000);
    });

    it("rejects negative approval limit override", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            approvalLimitOverrides: { ap_clerk: -100 }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });

    it("rejects non-integer approval limit override", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            approvalLimitOverrides: { ap_clerk: 99.5 }
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /admin/compliance-config — additional freemail domains", () => {
    it("accepts valid additional freemail domains", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            additionalFreemailDomains: ["protonmail.com", "zoho.com"]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.additionalFreemailDomains).toEqual(["protonmail.com", "zoho.com"]);
    });

    it("rejects invalid domain format", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            additionalFreemailDomains: ["not a domain"]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });

    it("rejects empty string in freemail domains", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: {
            additionalFreemailDomains: [""]
          }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /admin/compliance-config — learning mode", () => {
    it("accepts valid learning mode 'active'", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { learningMode: "active" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).learningMode).toBe("active");
    });

    it("accepts valid learning mode 'assistive'", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { learningMode: "assistive" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).learningMode).toBe("assistive");
    });

    it("rejects invalid learning mode", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { learningMode: "invalid" }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
    });
  });

  describe("PUT /admin/compliance-config — ocrWeight + completenessWeight sum validation", () => {
    it("rejects when both weights are provided and do not sum to 1.0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 0.6, completenessWeight: 0.6 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(400);
      expect((res.jsonBody as { message: string }).message).toContain("sum to 1.0");
    });

    it("accepts when both weights sum to 1.0", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 0.7, completenessWeight: 0.3 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      const body = res.jsonBody as Record<string, unknown>;
      expect(body.ocrWeight).toBe(0.7);
      expect(body.completenessWeight).toBe(0.3);
    });

    it("allows ocrWeight alone without completenessWeight", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { ocrWeight: 0.8 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).ocrWeight).toBe(0.8);
    });

    it("allows completenessWeight alone without ocrWeight", async () => {
      const router = createTenantComplianceConfigRouter();
      const handler = findHandler(router, "put", "/admin/compliance-config");
      const res = mockResponse();

      await handler(
        mockRequest({
          authContext: defaultAuth,
          body: { completenessWeight: 0.4 }
        }),
        res,
        nextFn
      );

      expect(res.statusCode).toBe(200);
      expect((res.jsonBody as Record<string, unknown>).completenessWeight).toBe(0.4);
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
