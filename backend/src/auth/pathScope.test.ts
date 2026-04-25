import { Types } from "mongoose";
import { requireMatchingTenantIdParam, requirePathClientOrgOwnership } from "@/auth/pathScope.ts";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.ts";
import { mockRequest, mockResponse, defaultAuth } from "@/routes/testHelpers.ts";

jest.mock("@/services/auth/tenantScope.ts", () => ({
  findClientOrgIdByIdForTenant: jest.fn()
}));

const mockFind = findClientOrgIdByIdForTenant as jest.MockedFunction<typeof findClientOrgIdByIdForTenant>;

const VALID_CLIENT_ORG_ID = new Types.ObjectId();

function buildReq(overrides: Record<string, unknown> = {}) {
  return mockRequest({ authContext: defaultAuth, ...overrides }) as unknown as import("express").Request;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("requireMatchingTenantIdParam", () => {
  it("calls next() when path tenantId matches authenticated tenantId", () => {
    const req = buildReq({ params: { tenantId: defaultAuth.tenantId } });
    const res = mockResponse();
    const next = jest.fn();

    requireMatchingTenantIdParam(req, res as unknown as import("express").Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.statusCode).toBe(200);
  });

  it("returns 403 when path tenantId differs from authenticated tenantId", () => {
    const req = buildReq({ params: { tenantId: "tenant-other" } });
    const res = mockResponse();
    const next = jest.fn();

    requireMatchingTenantIdParam(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when path tenantId is missing", () => {
    const req = buildReq({ params: {} });
    const res = mockResponse();
    const next = jest.fn();

    requireMatchingTenantIdParam(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("requirePathClientOrgOwnership", () => {
  it("stamps req.activeClientOrgId and calls next() when clientOrg is owned by tenant", async () => {
    mockFind.mockResolvedValue(VALID_CLIENT_ORG_ID);
    const req = buildReq({ params: { clientOrgId: VALID_CLIENT_ORG_ID.toHexString() } });
    const res = mockResponse();
    const next = jest.fn();

    await requirePathClientOrgOwnership(req, res as unknown as import("express").Response, next);

    expect(mockFind).toHaveBeenCalledWith(VALID_CLIENT_ORG_ID.toHexString(), defaultAuth.tenantId);
    expect(req.activeClientOrgId).toBe(VALID_CLIENT_ORG_ID);
    expect(next).toHaveBeenCalledWith();
  });

  it("returns 400 when clientOrg path param is missing", async () => {
    const req = buildReq({ params: {} });
    const res = mockResponse();
    const next = jest.fn();

    await requirePathClientOrgOwnership(req, res as unknown as import("express").Response, next);

    expect(mockFind).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 when clientOrg does not belong to tenant", async () => {
    mockFind.mockResolvedValue(null);
    const req = buildReq({ params: { clientOrgId: VALID_CLIENT_ORG_ID.toHexString() } });
    const res = mockResponse();
    const next = jest.fn();

    await requirePathClientOrgOwnership(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("propagates async errors via next(error)", async () => {
    const boom = new Error("db down");
    mockFind.mockRejectedValue(boom);
    const req = buildReq({ params: { clientOrgId: VALID_CLIENT_ORG_ID.toHexString() } });
    const res = mockResponse();
    const next = jest.fn();

    await requirePathClientOrgOwnership(req, res as unknown as import("express").Response, next);

    expect(next).toHaveBeenCalledWith(boom);
  });
});
