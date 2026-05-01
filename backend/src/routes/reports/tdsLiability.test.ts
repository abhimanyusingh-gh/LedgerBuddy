jest.mock("../../auth/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: Function) => next()
}));

const getReportMock = jest.fn();
jest.mock("@/services/tds/TdsLiabilityReportService.ts", () => ({
  TdsLiabilityReportService: jest.fn().mockImplementation(() => ({
    getReport: (...args: unknown[]) => getReportMock(...args)
  })),
  isTdsQuarter: (value: unknown) => value === "Q1" || value === "Q2" || value === "Q3" || value === "Q4"
}));

import { defaultAuth, findHandler, mockRequest, mockResponse } from "@/routes/testHelpers.ts";
import { createTdsLiabilityReportRouter } from "./tdsLiability.ts";

const nextFn = jest.fn();

const EMPTY_REPORT = {
  tan: null,
  fy: "2026-27",
  bySection: [],
  byVendor: [],
  byQuarter: []
};

beforeEach(() => {
  getReportMock.mockReset();
  nextFn.mockReset();
});

describe("GET /reports/tds-liability", () => {
  it("returns the report scoped to the authenticated tenant", async () => {
    getReportMock.mockResolvedValueOnce(EMPTY_REPORT);
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { fy: "2026-27" } }),
      res,
      nextFn
    );

    expect(getReportMock).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      financialYear: "2026-27"
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual(EMPTY_REPORT);
  });

  it("forwards optional vendorFingerprint, section and quarter filters", async () => {
    getReportMock.mockResolvedValueOnce(EMPTY_REPORT);
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: {
          fy: "2026-27",
          vendorFingerprint: "vendor-acme",
          section: "194J",
          quarter: "Q2"
        }
      }),
      mockResponse(),
      nextFn
    );

    expect(getReportMock).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      financialYear: "2026-27",
      vendorFingerprint: "vendor-acme",
      section: "194J",
      quarter: "Q2"
    });
  });

  it("returns 400 invalid_fy when fy is missing", async () => {
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");
    const res = mockResponse();

    await handler(mockRequest({ authContext: defaultAuth, query: {} }), res, nextFn);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "invalid_fy",
      message: expect.stringContaining("fy")
    });
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_fy when fy is malformed", async () => {
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");
    const res = mockResponse();

    await handler(
      mockRequest({ authContext: defaultAuth, query: { fy: "2026" } }),
      res,
      nextFn
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { error: string }).error).toBe("invalid_fy");
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("returns 400 invalid_quarter when quarter is not Q1-Q4", async () => {
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");
    const res = mockResponse();

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { fy: "2026-27", quarter: "Q5" }
      }),
      res,
      nextFn
    );

    expect(res.statusCode).toBe(400);
    expect((res.jsonBody as { error: string }).error).toBe("invalid_quarter");
    expect(getReportMock).not.toHaveBeenCalled();
  });

  it("ignores empty optional query strings", async () => {
    getReportMock.mockResolvedValueOnce(EMPTY_REPORT);
    const router = createTdsLiabilityReportRouter();
    const handler = findHandler(router, "get", "/reports/tds-liability");

    await handler(
      mockRequest({
        authContext: defaultAuth,
        query: { fy: "2026-27", vendorFingerprint: "  ", section: "", quarter: "" }
      }),
      mockResponse(),
      nextFn
    );

    expect(getReportMock).toHaveBeenCalledWith({
      tenantId: defaultAuth.tenantId,
      financialYear: "2026-27"
    });
  });
});
