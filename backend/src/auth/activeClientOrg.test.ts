import { Types } from "mongoose";
import { requireActiveClientOrg, CLIENT_ORG_ID_SOURCE } from "@/auth/activeClientOrg.ts";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.ts";
import { mockRequest, mockResponse, defaultAuth } from "@/routes/testHelpers.ts";

jest.mock("@/services/auth/tenantScope.ts", () => ({
  findClientOrgIdByIdForTenant: jest.fn()
}));

const mockFind = findClientOrgIdByIdForTenant as jest.MockedFunction<typeof findClientOrgIdByIdForTenant>;

const VALID_ID_QUERY = new Types.ObjectId();
const VALID_ID_HEADER = new Types.ObjectId();
const VALID_ID_SESSION = new Types.ObjectId();

function buildReq(overrides: Record<string, unknown> = {}) {
  const headers = (overrides.headers ?? {}) as Record<string, string>;
  return mockRequest({
    authContext: defaultAuth,
    // mockRequest defaults `activeClientOrgId` to DEFAULT_ACTIVE_CLIENT_ORG_ID
    // (suits the route handler tests), but for the source-priority chain we
    // exercise the legacy query/header/session path — so clear the pre-stamp.
    activeClientOrgId: undefined,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    ...overrides
  }) as unknown as import("express").Request;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("requireActiveClientOrg", () => {
  it("short-circuits when req.activeClientOrgId is already stamped (path-scoped middleware ran upstream)", async () => {
    // The nested-router scaffold (#171) installs `requirePathClientOrgOwnership`
    // on the new `/api/tenants/:tenantId/clientOrgs/:clientOrgId/...` mount,
    // which validates and stamps `req.activeClientOrgId` from the path. When
    // a router mounted under BOTH shapes still calls `requireActiveClientOrg`
    // internally, the source-priority chain (query/header/session) must NOT
    // re-run — there is no clientOrgId query/header in the new path shape and
    // the lookup would 400 spuriously.
    const preStamped = new Types.ObjectId();
    const req = buildReq({});
    req.activeClientOrgId = preStamped;
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(mockFind).not.toHaveBeenCalled();
    expect(req.activeClientOrgId).toBe(preStamped);
    expect(next).toHaveBeenCalledWith();
    // mockResponse defaults statusCode=200; assert no error response was set.
    expect(res.jsonBody).toBeUndefined();
  });

  it("resolves clientOrgId from query string (highest priority)", async () => {
    mockFind.mockResolvedValue(VALID_ID_QUERY);
    const req = buildReq({
      query: { clientOrgId: VALID_ID_QUERY.toHexString() },
      headers: { "x-client-org-id": VALID_ID_HEADER.toHexString() },
      session: { activeClientOrgId: VALID_ID_SESSION.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(mockFind).toHaveBeenCalledWith(VALID_ID_QUERY.toHexString(), defaultAuth.tenantId);
    expect(req.activeClientOrgId).toBe(VALID_ID_QUERY);
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to header when query is absent", async () => {
    mockFind.mockResolvedValue(VALID_ID_HEADER);
    const req = buildReq({
      headers: { "x-client-org-id": VALID_ID_HEADER.toHexString() },
      session: { activeClientOrgId: VALID_ID_SESSION.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(mockFind).toHaveBeenCalledWith(VALID_ID_HEADER.toHexString(), defaultAuth.tenantId);
    expect(req.activeClientOrgId).toBe(VALID_ID_HEADER);
    expect(next).toHaveBeenCalledWith();
  });

  it("falls back to session when query and header are absent", async () => {
    mockFind.mockResolvedValue(VALID_ID_SESSION);
    const req = buildReq({
      session: { activeClientOrgId: VALID_ID_SESSION.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(mockFind).toHaveBeenCalledWith(VALID_ID_SESSION.toHexString(), defaultAuth.tenantId);
    expect(req.activeClientOrgId).toBe(VALID_ID_SESSION);
    expect(next).toHaveBeenCalledWith();
  });

  it("ignores session when session middleware not installed", async () => {
    const req = buildReq({});
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(mockFind).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "clientOrgId required and must belong to tenant",
      source: CLIENT_ORG_ID_SOURCE.NONE
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 400 with source=query when query value does not belong to tenant", async () => {
    mockFind.mockResolvedValue(null);
    const req = buildReq({
      query: { clientOrgId: VALID_ID_QUERY.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "clientOrgId required and must belong to tenant",
      source: CLIENT_ORG_ID_SOURCE.QUERY
    });
  });

  it("returns 400 with source=header when header value does not belong to tenant", async () => {
    mockFind.mockResolvedValue(null);
    const req = buildReq({
      headers: { "x-client-org-id": VALID_ID_HEADER.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "clientOrgId required and must belong to tenant",
      source: CLIENT_ORG_ID_SOURCE.HEADER
    });
  });

  it("returns 400 with source=session when session value does not belong to tenant", async () => {
    mockFind.mockResolvedValue(null);
    const req = buildReq({
      session: { activeClientOrgId: VALID_ID_SESSION.toHexString() }
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireActiveClientOrg(req, res as unknown as import("express").Response, next);

    expect(res.statusCode).toBe(400);
    expect(res.jsonBody).toEqual({
      error: "clientOrgId required and must belong to tenant",
      source: CLIENT_ORG_ID_SOURCE.SESSION
    });
  });
});
