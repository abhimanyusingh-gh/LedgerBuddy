import {
  VENDOR_DETAIL_DEFAULT_SUB_TAB,
  buildVendorDetailHash,
  parseVendorDetailHash
} from "@/features/vendors/vendorDetailHashState";
import { VENDOR_DETAIL_SUB_TAB, type VendorId } from "@/types/vendor";

const VENDOR_A = "65a0000000000000000000aa" as VendorId;

describe("features/vendors/vendorDetailHashState — parse", () => {
  it("returns null for unrelated hashes", () => {
    expect(parseVendorDetailHash("#/vendors")).toBeNull();
    expect(parseVendorDetailHash("#/triage")).toBeNull();
    expect(parseVendorDetailHash("")).toBeNull();
  });

  it("parses the bare detail hash with default sub-tab", () => {
    const route = parseVendorDetailHash(`#/vendors/${VENDOR_A}`);
    expect(route).not.toBeNull();
    expect(route?.vendorId).toBe(VENDOR_A);
    expect(route?.subTab).toBe(VENDOR_DETAIL_DEFAULT_SUB_TAB);
  });

  it("parses the tds sub-tab", () => {
    const route = parseVendorDetailHash(`#/vendors/${VENDOR_A}?tab=tds`);
    expect(route?.subTab).toBe(VENDOR_DETAIL_SUB_TAB.TDS);
  });

  it("parses the cert197 sub-tab", () => {
    const route = parseVendorDetailHash(`#/vendors/${VENDOR_A}?tab=cert197`);
    expect(route?.subTab).toBe(VENDOR_DETAIL_SUB_TAB.CERT197);
  });

  it("falls back to default for invalid sub-tab values", () => {
    const route = parseVendorDetailHash(`#/vendors/${VENDOR_A}?tab=garbage`);
    expect(route?.subTab).toBe(VENDOR_DETAIL_DEFAULT_SUB_TAB);
  });
});

describe("features/vendors/vendorDetailHashState — build", () => {
  it("builds bare hash for default sub-tab", () => {
    expect(buildVendorDetailHash({ vendorId: VENDOR_A, subTab: VENDOR_DETAIL_DEFAULT_SUB_TAB })).toBe(
      `#/vendors/${VENDOR_A}`
    );
  });

  it("round-trips through tds sub-tab", () => {
    const hash = buildVendorDetailHash({ vendorId: VENDOR_A, subTab: VENDOR_DETAIL_SUB_TAB.TDS });
    expect(hash).toBe(`#/vendors/${VENDOR_A}?tab=tds`);
    const parsed = parseVendorDetailHash(hash);
    expect(parsed?.vendorId).toBe(VENDOR_A);
    expect(parsed?.subTab).toBe(VENDOR_DETAIL_SUB_TAB.TDS);
  });

  it("round-trips through cert197 sub-tab", () => {
    const hash = buildVendorDetailHash({ vendorId: VENDOR_A, subTab: VENDOR_DETAIL_SUB_TAB.CERT197 });
    expect(parseVendorDetailHash(hash)?.subTab).toBe(VENDOR_DETAIL_SUB_TAB.CERT197);
  });
});
