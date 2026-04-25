import { Types } from "mongoose";
import {
  resolveOptionalClientOrgId,
  OPTIONAL_CLIENT_ORG_ERROR_CODE,
  OPTIONAL_CLIENT_ORG_ERROR_MESSAGE
} from "@/auth/optionalClientOrg.ts";
import { findClientOrgIdByIdForTenant } from "@/services/auth/tenantScope.ts";
import { defaultAuth, mockRequest } from "@/routes/testHelpers.ts";

jest.mock("@/services/auth/tenantScope.ts", () => ({
  findClientOrgIdByIdForTenant: jest.fn()
}));

const mockFind = findClientOrgIdByIdForTenant as jest.MockedFunction<typeof findClientOrgIdByIdForTenant>;

const VALID_ID = new Types.ObjectId();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("resolveOptionalClientOrgId", () => {
  it("returns clientOrgId=null when query param absent", async () => {
    const req = mockRequest({ authContext: defaultAuth, query: {} }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({ valid: true, clientOrgId: null });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns clientOrgId=null when query param is empty string", async () => {
    const req = mockRequest({ authContext: defaultAuth, query: { clientOrgId: "" } }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({ valid: true, clientOrgId: null });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns clientOrgId=null when query param is whitespace only", async () => {
    const req = mockRequest({ authContext: defaultAuth, query: { clientOrgId: "   " } }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({ valid: true, clientOrgId: null });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("returns ownership-validated ObjectId when query param is valid for tenant", async () => {
    mockFind.mockResolvedValue(VALID_ID);
    const req = mockRequest({
      authContext: defaultAuth,
      query: { clientOrgId: VALID_ID.toHexString() }
    }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(mockFind).toHaveBeenCalledWith(VALID_ID.toHexString(), defaultAuth.tenantId);
    expect(result).toEqual({ valid: true, clientOrgId: VALID_ID });
  });

  it("trims whitespace around the query value before validating", async () => {
    mockFind.mockResolvedValue(VALID_ID);
    const req = mockRequest({
      authContext: defaultAuth,
      query: { clientOrgId: `  ${VALID_ID.toHexString()}  ` }
    }) as unknown as import("express").Request;

    await resolveOptionalClientOrgId(req);

    expect(mockFind).toHaveBeenCalledWith(VALID_ID.toHexString(), defaultAuth.tenantId);
  });

  it("returns invalid result when query param does not belong to tenant", async () => {
    mockFind.mockResolvedValue(null);
    const foreignId = new Types.ObjectId();
    const req = mockRequest({
      authContext: defaultAuth,
      query: { clientOrgId: foreignId.toHexString() }
    }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({
      valid: false,
      error: OPTIONAL_CLIENT_ORG_ERROR_CODE,
      message: OPTIONAL_CLIENT_ORG_ERROR_MESSAGE
    });
  });

  it("ignores headers and session — query string only", async () => {
    const headerId = new Types.ObjectId();
    const req = mockRequest({
      authContext: defaultAuth,
      query: {},
      header(_name: string) {
        return headerId.toHexString();
      },
      session: { activeClientOrgId: new Types.ObjectId().toHexString() }
    }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({ valid: true, clientOrgId: null });
    expect(mockFind).not.toHaveBeenCalled();
  });

  it("ignores non-string query values (e.g. arrays)", async () => {
    const req = mockRequest({
      authContext: defaultAuth,
      query: { clientOrgId: ["a", "b"] as unknown as string }
    }) as unknown as import("express").Request;

    const result = await resolveOptionalClientOrgId(req);

    expect(result).toEqual({ valid: true, clientOrgId: null });
    expect(mockFind).not.toHaveBeenCalled();
  });
});
