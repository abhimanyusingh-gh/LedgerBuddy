jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

const findClientOrgIdByIdForTenantMock = jest.fn();
jest.mock("@/services/auth/tenantScope.ts", () => ({
  findClientOrgIdByIdForTenant: (...args: unknown[]) => findClientOrgIdByIdForTenantMock(...args)
}));

const getOverviewMock = jest.fn();
jest.mock("@/services/platform/analyticsService.ts", () => ({
  getOverview: (...args: unknown[]) => getOverviewMock(...args)
}));

import { Types } from "mongoose";
import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { createAnalyticsRouter } from "./analytics.ts";

const nextFn = jest.fn();

const EMPTY_OVERVIEW = {
  kpis: {
    totalInvoices: 0,
    approvedCount: 0,
    approvedAmountMinor: 0,
    pendingAmountMinor: 0,
    exportedCount: 0,
    needsReviewCount: 0
  },
  dailyApprovals: [],
  dailyIngestion: [],
  dailyExports: [],
  statusBreakdown: [],
  topVendorsByApproved: [],
  topVendorsByPending: []
};

beforeEach(() => {
  findClientOrgIdByIdForTenantMock.mockReset();
  getOverviewMock.mockReset();
  nextFn.mockReset();
});

describe("GET /analytics/overview — optional clientOrgId (#162)", () => {
  it("aggregates across the tenant when clientOrgId is absent", async () => {
    getOverviewMock.mockResolvedValueOnce(EMPTY_OVERVIEW);
    const router = createAnalyticsRouter();
    const handler = findHandler(router, "get", "/analytics/overview");
    const res = mockResponse();

    await handler(mockRequest({ authContext: defaultAuth, query: {} }), res, nextFn);

    expect(findClientOrgIdByIdForTenantMock).not.toHaveBeenCalled();
    expect(getOverviewMock).toHaveBeenCalledTimes(1);
    const [tenantArg, , , optionsArg] = getOverviewMock.mock.calls[0];
    expect(tenantArg).toBe(defaultAuth.tenantId);
    expect(optionsArg).toMatchObject({ clientOrgId: null });
    expect(res.statusCode).toBe(200);
  });

  it("scopes to the supplied clientOrgId after ownership validation", async () => {
    const validId = new Types.ObjectId();
    findClientOrgIdByIdForTenantMock.mockResolvedValueOnce(validId);
    getOverviewMock.mockResolvedValueOnce(EMPTY_OVERVIEW);
    const router = createAnalyticsRouter();
    const handler = findHandler(router, "get", "/analytics/overview");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { clientOrgId: validId.toHexString() } }),
      res,
      nextFn
    );

    expect(findClientOrgIdByIdForTenantMock).toHaveBeenCalledWith(
      validId.toHexString(),
      defaultAuth.tenantId
    );
    expect(getOverviewMock).toHaveBeenCalledTimes(1);
    const [, , , optionsArg] = getOverviewMock.mock.calls[0];
    expect(optionsArg).toMatchObject({ clientOrgId: validId });
    expect(res.statusCode).toBe(200);
  });

  it("returns 400 invalid_client_org_id when clientOrgId does not belong to tenant", async () => {
    findClientOrgIdByIdForTenantMock.mockResolvedValueOnce(null);
    const foreignId = new Types.ObjectId();
    const router = createAnalyticsRouter();
    const handler = findHandler(router, "get", "/analytics/overview");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { clientOrgId: foreignId.toHexString() } }),
      res,
      nextFn
    );

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "invalid_client_org_id",
      message: "clientOrgId does not belong to this tenant"
    });
    expect(getOverviewMock).not.toHaveBeenCalled();
  });

  it("preserves existing scope=mine|all approver behavior alongside clientOrgId", async () => {
    const validId = new Types.ObjectId();
    findClientOrgIdByIdForTenantMock.mockResolvedValueOnce(validId);
    getOverviewMock.mockResolvedValueOnce(EMPTY_OVERVIEW);
    const router = createAnalyticsRouter();
    const handler = findHandler(router, "get", "/analytics/overview");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { clientOrgId: validId.toHexString(), scope: "all" }
      }),
      mockResponse(),
      nextFn
    );

    const [, , , optionsArg] = getOverviewMock.mock.calls[0];
    expect(optionsArg).toMatchObject({ clientOrgId: validId });
    expect(optionsArg.approverId).toBeUndefined();
  });

  it("defaults scope=mine to approverId=auth.userId when clientOrgId absent", async () => {
    getOverviewMock.mockResolvedValueOnce(EMPTY_OVERVIEW);
    const router = createAnalyticsRouter();
    const handler = findHandler(router, "get", "/analytics/overview");

    await handler(
      mockRequest({ authContext: defaultAuth, query: {} }),
      mockResponse(),
      nextFn
    );

    const [, , , optionsArg] = getOverviewMock.mock.calls[0];
    expect(optionsArg.approverId).toBe(defaultAuth.userId);
    expect(optionsArg.clientOrgId).toBeNull();
  });
});
