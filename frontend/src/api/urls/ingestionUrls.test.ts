/**
 * @jest-environment jsdom
 */
import { ingestionUrls } from "@/api/urls/ingestionUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { getMockedApiClientModule } from "@/test-utils/mockApiClient";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule({
    authenticatedUrl: jest.fn(
      (path: string) => `https://api.example.com${path}?authToken=tok`
    )
  });
});

const { authenticatedUrl: mockAuthenticatedUrl } = getMockedApiClientModule<{
  authenticatedUrl: jest.Mock;
}>();

beforeEach(() => {
  jest.clearAllMocks();
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/ingestionUrls.sseStatus", () => {
  it("constructs the tenant-scoped SSE URL via the URL provider", () => {
    const url = ingestionUrls.sseStatus();
    expect(mockAuthenticatedUrl).toHaveBeenCalledWith(
      "/tenants/tenant-1/jobs/ingest/sse"
    );
    expect(url).toContain("/tenants/tenant-1/jobs/ingest/sse");
    expect(url).toContain("authToken=tok");
  });

  it("throws MissingActiveClientOrgError at URL-construction time when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => ingestionUrls.sseStatus()).toThrow(MissingActiveClientOrgError);
    expect(mockAuthenticatedUrl).not.toHaveBeenCalled();
  });
});

describe("api/urls/ingestionUrls — tenant-scoped orchestration", () => {
  it.each([
    ["presign", "/tenants/tenant-1/uploads/presign"],
    ["ingestRun", "/tenants/tenant-1/jobs/ingest"],
    ["ingestPause", "/tenants/tenant-1/jobs/ingest/pause"],
    ["ingestStatus", "/tenants/tenant-1/jobs/ingest/status"]
  ] as const)("%s resolves to %s", (method, expected) => {
    const fn = ingestionUrls[method] as () => string;
    expect(fn()).toBe(expected);
  });
});

describe("api/urls/ingestionUrls — realm-scoped uploads", () => {
  it.each([
    ["upload", "/tenants/tenant-1/clientOrgs/client-1/jobs/upload"],
    ["uploadByKeys", "/tenants/tenant-1/clientOrgs/client-1/jobs/upload/by-keys"]
  ] as const)("%s resolves to %s", (method, expected) => {
    const fn = ingestionUrls[method] as () => string;
    expect(fn()).toBe(expected);
  });

  it("realm-scoped methods throw when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => ingestionUrls.upload()).toThrow(MissingActiveClientOrgError);
    expect(() => ingestionUrls.uploadByKeys()).toThrow(MissingActiveClientOrgError);
  });
});
