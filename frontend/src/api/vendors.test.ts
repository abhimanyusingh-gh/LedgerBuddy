/**
 * @jest-environment jsdom
 */
import { fetchVendorList } from "@/api/vendors";
import { apiClient } from "@/api/client";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";
import { VENDOR_SORT_DIRECTION, VENDOR_SORT_FIELD, VENDOR_STATUS } from "@/types/vendor";

jest.mock("@/api/client", () => ({
  apiClient: { get: jest.fn() }
}));

const mockGet = (apiClient.get as unknown) as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
  mockGet.mockResolvedValue({
    data: { items: [], page: 1, limit: 50, total: 0 }
  });
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/vendors — fetchVendorList parameter shaping", () => {
  it("hits the vendors list URL", async () => {
    await fetchVendorList({});
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet.mock.calls[0][0]).toBe("/tenants/tenant-1/clientOrgs/client-1/vendors");
  });

  it("omits empty/undefined params and applies sort + page defaults", async () => {
    await fetchVendorList({});
    const params = mockGet.mock.calls[0][1].params;
    expect(params.search).toBeUndefined();
    expect(params.status).toBeUndefined();
    expect(params.hasMsme).toBeUndefined();
    expect(params.hasSection197Cert).toBeUndefined();
    expect(params.sortField).toBe(VENDOR_SORT_FIELD.LAST_INVOICE_DATE);
    expect(params.sortDirection).toBe(VENDOR_SORT_DIRECTION.DESC);
    expect(params.page).toBe(1);
    expect(params.limit).toBe(50);
  });

  it("forwards search, status, tri-bool flags, sort + paging", async () => {
    await fetchVendorList({
      search: "  acme  ",
      status: VENDOR_STATUS.BLOCKED,
      hasMsme: true,
      hasSection197Cert: false,
      sortField: VENDOR_SORT_FIELD.NAME,
      sortDirection: VENDOR_SORT_DIRECTION.ASC,
      page: 3,
      limit: 25
    });
    const params = mockGet.mock.calls[0][1].params;
    expect(params.search).toBe("acme");
    expect(params.status).toBe(VENDOR_STATUS.BLOCKED);
    expect(params.hasMsme).toBe("true");
    expect(params.hasSection197Cert).toBe("false");
    expect(params.sortField).toBe(VENDOR_SORT_FIELD.NAME);
    expect(params.sortDirection).toBe(VENDOR_SORT_DIRECTION.ASC);
    expect(params.page).toBe(3);
    expect(params.limit).toBe(25);
  });

  it("normalises a malformed response shape", async () => {
    mockGet.mockResolvedValueOnce({ data: null });
    const result = await fetchVendorList({});
    expect(result.items).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(50);
    expect(result.total).toBe(0);
  });
});
