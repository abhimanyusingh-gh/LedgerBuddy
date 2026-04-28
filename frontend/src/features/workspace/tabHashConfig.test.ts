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
});
