/**
 * @jest-environment jsdom
 */
import { getInvoicePreviewUrl } from "@/api/invoices";
import { MissingActiveClientOrgError } from "@/api/errors";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { writeActiveTenantId } from "@/api/tenantStorage";

jest.mock("@/api/client", () => ({
  apiClient: {},
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
  ),
  safeNum: (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback,
  stripNulls: (v: unknown) => v
}));

const { authenticatedUrl } = jest.requireMock("@/api/client") as {
  authenticatedUrl: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("org-9");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/invoices — getInvoicePreviewUrl", () => {
  it("constructs the nested-shape preview URL after #220 BE migration", () => {
    const url = getInvoicePreviewUrl("inv-abc", 2);
    expect(authenticatedUrl).toHaveBeenCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 2 }
    );
    expect(url).toContain(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview"
    );
  });

  it("defaults page to 1 and clamps non-positive page values", () => {
    getInvoicePreviewUrl("inv-abc");
    expect(authenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 1 }
    );
    getInvoicePreviewUrl("inv-abc", 0);
    expect(authenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 1 }
    );
  });

  it("rounds fractional page numbers to the nearest integer", () => {
    getInvoicePreviewUrl("inv-abc", 3.6);
    expect(authenticatedUrl).toHaveBeenLastCalledWith(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/inv-abc/preview",
      { page: 4 }
    );
  });

  it("throws MissingActiveClientOrgError when tenantId is unset (mirrors interceptor guard)", () => {
    writeActiveTenantId(null);
    expect(() => getInvoicePreviewUrl("inv-abc")).toThrow(
      MissingActiveClientOrgError
    );
    expect(authenticatedUrl).not.toHaveBeenCalled();
  });

  it("throws MissingActiveClientOrgError when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => getInvoicePreviewUrl("inv-abc")).toThrow(
      MissingActiveClientOrgError
    );
    expect(authenticatedUrl).not.toHaveBeenCalled();
  });
});
