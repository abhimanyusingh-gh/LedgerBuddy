/**
 * @jest-environment jsdom
 */
import { invoiceUrls } from "@/api/urls/invoiceUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { getMockedApiClientModule } from "@/test-utils/mockApiClient";

jest.mock("@/api/client", () => {
  const { buildApiClientMockModule } = require("@/test-utils/mockApiClient");
  return buildApiClientMockModule({
    authenticatedUrl: jest.fn(
      (path: string, params?: Record<string, unknown>) => {
        const query = params
          ? new URLSearchParams(
              Object.entries(params).map(([k, v]) => [k, String(v)])
            ).toString()
          : "";
        const separator = query ? `?${query}&` : "?";
        return `https://api.example.com${path}${separator}authToken=tok`;
      }
    )
  });
});

const { authenticatedUrl: mockAuthenticatedUrl } = getMockedApiClientModule<{
  authenticatedUrl: jest.Mock;
}>();

beforeEach(() => {
  jest.clearAllMocks();
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("org-9");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/invoiceUrls.preview", () => {
  it("constructs the nested-shape preview URL via the URL provider", () => {
    const url = invoiceUrls.preview("inv-abc", 2);
    expect(mockAuthenticatedUrl).toHaveBeenCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 2 }
    );
    expect(url).toContain(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview"
    );
  });

  it("defaults page to 1 and clamps non-positive page values", () => {
    invoiceUrls.preview("inv-abc");
    expect(mockAuthenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 1 }
    );
    invoiceUrls.preview("inv-abc", 0);
    expect(mockAuthenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 1 }
    );
  });

  it("rounds fractional page numbers to the nearest integer", () => {
    invoiceUrls.preview("inv-abc", 3.6);
    expect(mockAuthenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 4 }
    );
  });

  it("throws MissingActiveClientOrgError at URL-construction time when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => invoiceUrls.preview("inv-abc")).toThrow(
      MissingActiveClientOrgError
    );
    expect(mockAuthenticatedUrl).not.toHaveBeenCalled();
  });

  it("throws MissingActiveClientOrgError at URL-construction time when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => invoiceUrls.preview("inv-abc")).toThrow(
      MissingActiveClientOrgError
    );
    expect(mockAuthenticatedUrl).not.toHaveBeenCalled();
  });
});
