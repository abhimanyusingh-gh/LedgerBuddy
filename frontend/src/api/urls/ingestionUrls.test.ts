/**
 * @jest-environment jsdom
 */
import { ingestionUrls } from "@/api/urls/ingestionUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
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
});

afterEach(() => {
  writeActiveTenantId(null);
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
