import {
  STANDALONE_HASH_PATH,
  TAB_HASH_PATH,
  readStandaloneHashRoute
} from "@/features/workspace/tabHashConfig";

describe("features/workspace/tabHashConfig — standalone hash routes", () => {
  it("matches the registered mailboxes hash exactly", () => {
    expect(readStandaloneHashRoute("#/mailboxes")).toBe("mailboxes");
  });

  it("does not collide with any tab hash", () => {
    const tabHashes = new Set<string>(Object.values(TAB_HASH_PATH));
    for (const path of Object.values(STANDALONE_HASH_PATH)) {
      expect(tabHashes.has(path)).toBe(false);
    }
  });

  it("matches the registered triage hash exactly", () => {
    expect(readStandaloneHashRoute("#/triage")).toBe("triage");
  });

  it("returns null for tab hashes and unknown hashes", () => {
    expect(readStandaloneHashRoute("#/invoices")).toBeNull();
    expect(readStandaloneHashRoute("#/triage/extra")).toBeNull();
    expect(readStandaloneHashRoute("")).toBeNull();
    expect(readStandaloneHashRoute("#triage")).toBeNull();
  });

  it("matches the registered reports/tds hash, with or without query params", () => {
    expect(readStandaloneHashRoute("#/reports/tds")).toBe("reportsTds");
    expect(readStandaloneHashRoute("#/reports/tds?fy=2025-26")).toBe("reportsTds");
    expect(readStandaloneHashRoute("#/reports/tds?fy=2025-26&quarter=Q1")).toBe("reportsTds");
  });

  it("matches the registered vendors hash, with or without query params", () => {
    expect(readStandaloneHashRoute("#/vendors")).toBe("vendors");
    expect(readStandaloneHashRoute("#/vendors?q=acme&status=active")).toBe("vendors");
  });

  it("matches the vendor detail hash and is distinguished from the list", () => {
    expect(readStandaloneHashRoute("#/vendors/65a000000000000000000001")).toBe("vendorDetail");
    expect(readStandaloneHashRoute("#/vendors/65a000000000000000000001?tab=tds")).toBe("vendorDetail");
  });
});
