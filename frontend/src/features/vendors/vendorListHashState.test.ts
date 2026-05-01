import {
  buildVendorListHash,
  parseVendorListHash,
  VENDOR_LIST_DEFAULT_STATE
} from "@/features/vendors/vendorListHashState";
import { VENDOR_PAGE_SIZE, VENDOR_SORT_DIRECTION, VENDOR_SORT_FIELD, VENDOR_STATUS } from "@/types/vendor";

describe("features/vendors/vendorListHashState — parse", () => {
  it("returns defaults for the bare route hash", () => {
    expect(parseVendorListHash("#/vendors")).toEqual(VENDOR_LIST_DEFAULT_STATE);
  });

  it("returns defaults for an unrelated hash", () => {
    expect(parseVendorListHash("#/triage")).toEqual(VENDOR_LIST_DEFAULT_STATE);
  });

  it("parses search, status, msme, cert197", () => {
    const parsed = parseVendorListHash("#/vendors?q=acme&status=active&msme=yes&cert197=no");
    expect(parsed.search).toBe("acme");
    expect(parsed.status).toBe(VENDOR_STATUS.ACTIVE);
    expect(parsed.hasMsme).toBe(true);
    expect(parsed.hasSection197Cert).toBe(false);
  });

  it("parses sort + page + size", () => {
    const parsed = parseVendorListHash("#/vendors?sort=name&dir=asc&page=3&size=100");
    expect(parsed.sortField).toBe(VENDOR_SORT_FIELD.NAME);
    expect(parsed.sortDirection).toBe(VENDOR_SORT_DIRECTION.ASC);
    expect(parsed.page).toBe(3);
    expect(parsed.pageSize).toBe(VENDOR_PAGE_SIZE.HUNDRED);
  });

  it("ignores invalid status / sort / size values", () => {
    const parsed = parseVendorListHash("#/vendors?status=garbage&sort=bogus&size=7&page=-1");
    expect(parsed.status).toBeNull();
    expect(parsed.sortField).toBe(VENDOR_LIST_DEFAULT_STATE.sortField);
    expect(parsed.pageSize).toBe(VENDOR_LIST_DEFAULT_STATE.pageSize);
    expect(parsed.page).toBe(VENDOR_LIST_DEFAULT_STATE.page);
  });
});

describe("features/vendors/vendorListHashState — build", () => {
  it("builds the bare hash for the default state", () => {
    expect(buildVendorListHash(VENDOR_LIST_DEFAULT_STATE)).toBe("#/vendors");
  });

  it("round-trips a fully-populated state", () => {
    const state = {
      search: "acme corp",
      status: VENDOR_STATUS.BLOCKED,
      hasMsme: true,
      hasSection197Cert: false,
      sortField: VENDOR_SORT_FIELD.FYTD_SPEND,
      sortDirection: VENDOR_SORT_DIRECTION.ASC,
      page: 4,
      pageSize: VENDOR_PAGE_SIZE.TWENTY_FIVE
    };
    const hash = buildVendorListHash(state);
    expect(parseVendorListHash(hash)).toEqual(state);
  });

  it("omits defaults from the built hash", () => {
    const hash = buildVendorListHash({
      ...VENDOR_LIST_DEFAULT_STATE,
      search: "acme"
    });
    expect(hash).toBe("#/vendors?q=acme");
  });
});
