import { deriveVendorState, GSTIN_STATE_CODES } from "@/constants/gstinStateCodes.ts";

describe("GSTIN_STATE_CODES registry", () => {
  it("has exactly 37 entries (36 states/UTs + Other Territory code 97)", () => {
    expect(Object.keys(GSTIN_STATE_CODES)).toHaveLength(37);
  });

  it("every code is a 2-digit string", () => {
    for (const code of Object.keys(GSTIN_STATE_CODES)) {
      expect(code).toMatch(/^\d{2}$/);
    }
  });

  it("every state name is non-empty and free of leading/trailing whitespace", () => {
    for (const name of Object.values(GSTIN_STATE_CODES)) {
      expect(name.length).toBeGreaterThan(0);
      expect(name).toBe(name.trim());
    }
  });

  it("pins known codes to their canonical CBIC state names", () => {
    expect(GSTIN_STATE_CODES["27"]).toBe("Maharashtra");
    expect(GSTIN_STATE_CODES["29"]).toBe("Karnataka");
    expect(GSTIN_STATE_CODES["33"]).toBe("Tamil Nadu");
    expect(GSTIN_STATE_CODES["07"]).toBe("Delhi");
    expect(GSTIN_STATE_CODES["97"]).toBe("Other Territory");
  });
});

describe("deriveVendorState — GSTIN prefix path", () => {
  it("resolves a valid 15-char GSTIN by its first-2-char state code", () => {
    expect(deriveVendorState("27AABCA1234C1Z5")).toBe("Maharashtra");
    expect(deriveVendorState("29AABCA1234C1Z5")).toBe("Karnataka");
    expect(deriveVendorState("33AABCA1234C1ZA")).toBe("Tamil Nadu");
  });

  it("trims and upper-cases the GSTIN before lookup", () => {
    expect(deriveVendorState("  27aabca1234c1z5  ")).toBe("Maharashtra");
  });

  it("returns null for a GSTIN with an unknown (unassigned) prefix", () => {
    expect(deriveVendorState("99AABCA1234C1Z5")).toBeNull();
    expect(deriveVendorState("25AABCA1234C1Z5")).toBeNull();
    expect(deriveVendorState("28AABCA1234C1Z5")).toBeNull();
  });

  it("returns null for a malformed GSTIN (wrong length or bad structure)", () => {
    expect(deriveVendorState("27AABCA")).toBeNull();
    expect(deriveVendorState("INVALID-GSTIN-HERE")).toBeNull();
    expect(deriveVendorState("")).toBeNull();
  });
});

describe("deriveVendorState — address-state fallback", () => {
  it("falls back to addressState when GSTIN is missing", () => {
    expect(deriveVendorState(undefined, "Tamil Nadu")).toBe("Tamil Nadu");
  });

  it("canonicalises whitespace and case on addressState", () => {
    expect(deriveVendorState(null, "  MAHARASHTRA ")).toBe("Maharashtra");
    expect(deriveVendorState(null, "tamil   nadu")).toBe("Tamil Nadu");
    expect(deriveVendorState(null, "karnataka")).toBe("Karnataka");
  });

  it("treats '&' and 'and' as equivalent tokens in state names", () => {
    expect(deriveVendorState(null, "Jammu & Kashmir")).toBe("Jammu and Kashmir");
    expect(deriveVendorState(null, "Andaman & Nicobar Islands")).toBe("Andaman and Nicobar Islands");
  });

  it("scans a full address string for a whole-token state-name match", () => {
    expect(deriveVendorState(null, "Plot 42, Whitefield, Bengaluru, Karnataka - 560066")).toBe("Karnataka");
    expect(deriveVendorState(null, "A-1, Andheri East, Mumbai, Maharashtra 400069")).toBe("Maharashtra");
  });

  it("does not match a state name embedded inside a larger alphanumeric token", () => {
    expect(deriveVendorState(null, "Goatown Enterprises, Pune")).toBeNull();
  });

  it("returns null for an unrecognised address state", () => {
    expect(deriveVendorState(null, "Atlantis")).toBeNull();
  });

  it("picks the longest whole-token match when an address mentions two state names", () => {
    expect(
      deriveVendorState(null, "Head office in Goa with a branch in Andhra Pradesh")
    ).toBe("Andhra Pradesh");
  });

  it("breaks ties between equal-length matches alphabetically on the canonical name", () => {
    expect(
      deriveVendorState(null, "Shared facility between Bihar and Delhi - both 6 chars")
    ).toBe("Bihar");
  });
});

describe("deriveVendorState — precedence + missing inputs", () => {
  it("prefers the GSTIN-derived state over addressState when GSTIN is valid", () => {
    expect(deriveVendorState("27AABCA1234C1Z5", "Karnataka")).toBe("Maharashtra");
  });

  it("falls through to addressState when the GSTIN is invalid", () => {
    expect(deriveVendorState("99AABCA1234C1Z5", "Tamil Nadu")).toBe("Tamil Nadu");
  });

  it("returns null when both GSTIN and addressState are absent", () => {
    expect(deriveVendorState()).toBeNull();
    expect(deriveVendorState(null, null)).toBeNull();
    expect(deriveVendorState(undefined, undefined)).toBeNull();
  });
});
