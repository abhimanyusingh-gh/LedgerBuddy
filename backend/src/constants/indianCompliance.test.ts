import {
  PAN_FORMAT,
  GSTIN_FORMAT,
  UDYAM_FORMAT,
  IRN_FORMAT,
  ADDRESS_SIGNAL_PATTERN,
  E_INVOICE_THRESHOLD_MINOR,
  VALID_PAN_CATEGORIES,
  extractPanFromGstin,
  derivePanCategory
} from "@/constants/indianCompliance";

describe("PAN_FORMAT", () => {
  it("matches valid PAN strings", () => {
    expect(PAN_FORMAT.test("ABCPK1234F")).toBe(true);
    expect(PAN_FORMAT.test("AABCC1234F")).toBe(true);
    expect(PAN_FORMAT.test("ZZZZZ9999Z")).toBe(true);
  });

  it("rejects invalid PAN strings", () => {
    expect(PAN_FORMAT.test("abcpk1234f")).toBe(false);
    expect(PAN_FORMAT.test("1234567890")).toBe(false);
    expect(PAN_FORMAT.test("ABCPK1234")).toBe(false);
    expect(PAN_FORMAT.test("ABCPK1234FG")).toBe(false);
    expect(PAN_FORMAT.test("")).toBe(false);
  });
});

describe("GSTIN_FORMAT", () => {
  it("matches valid GSTIN strings", () => {
    expect(GSTIN_FORMAT.test("29ABCPK1234F1Z5")).toBe(true);
    expect(GSTIN_FORMAT.test("07AABCC1234D1ZA")).toBe(true);
  });

  it("rejects invalid GSTIN strings", () => {
    expect(GSTIN_FORMAT.test("INVALID")).toBe(false);
    expect(GSTIN_FORMAT.test("29ABCPK1234F1X5")).toBe(false);
    expect(GSTIN_FORMAT.test("")).toBe(false);
  });
});

describe("UDYAM_FORMAT", () => {
  it("matches valid UDYAM numbers", () => {
    expect(UDYAM_FORMAT.test("UDYAM-KA-01-1234567")).toBe(true);
    expect(UDYAM_FORMAT.test("UDYAM-MH-99-0000001")).toBe(true);
  });

  it("rejects invalid UDYAM numbers", () => {
    expect(UDYAM_FORMAT.test("UDYAM-KA-1-1234567")).toBe(false);
    expect(UDYAM_FORMAT.test("NOTUDYAM-KA-01-1234567")).toBe(false);
    expect(UDYAM_FORMAT.test("")).toBe(false);
  });
});

describe("IRN_FORMAT", () => {
  it("matches valid 64-character hex string", () => {
    const validIrn = "a".repeat(64);
    expect(IRN_FORMAT.test(validIrn)).toBe(true);
    expect(IRN_FORMAT.test("A1b2C3d4".repeat(8))).toBe(true);
  });

  it("rejects non-hex or wrong-length strings", () => {
    expect(IRN_FORMAT.test("a".repeat(63))).toBe(false);
    expect(IRN_FORMAT.test("a".repeat(65))).toBe(false);
    expect(IRN_FORMAT.test("g".repeat(64))).toBe(false);
    expect(IRN_FORMAT.test("")).toBe(false);
  });
});

describe("ADDRESS_SIGNAL_PATTERN", () => {
  it("matches common address keywords", () => {
    expect(ADDRESS_SIGNAL_PATTERN.test("123 Main Street")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Warehouse No. 5")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Village Hobli")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Taluk Center")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("District Office")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Postal Code 560001")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Pin 560001")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("ZIP 12345")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Near Railway Station")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("State Highway")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Country Road")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("Karnataka Region")).toBe(true);
    expect(ADDRESS_SIGNAL_PATTERN.test("India Gate")).toBe(true);
  });

  it("does not match non-address text", () => {
    expect(ADDRESS_SIGNAL_PATTERN.test("ACME Corporation")).toBe(false);
    expect(ADDRESS_SIGNAL_PATTERN.test("Invoice #12345")).toBe(false);
  });
});

describe("E_INVOICE_THRESHOLD_MINOR", () => {
  it("equals 50 crore in minor units (paisa)", () => {
    expect(E_INVOICE_THRESHOLD_MINOR).toBe(500_000_000);
  });
});

describe("VALID_PAN_CATEGORIES", () => {
  it("contains all 10 valid PAN entity categories", () => {
    expect(VALID_PAN_CATEGORIES.size).toBe(10);
    for (const code of ["C", "P", "H", "F", "T", "A", "B", "L", "J", "G"]) {
      expect(VALID_PAN_CATEGORIES.has(code)).toBe(true);
    }
  });

  it("rejects unknown categories", () => {
    expect(VALID_PAN_CATEGORIES.has("X")).toBe(false);
    expect(VALID_PAN_CATEGORIES.has("Z")).toBe(false);
  });
});

describe("extractPanFromGstin", () => {
  it("extracts PAN (chars 3-12) from a GSTIN", () => {
    expect(extractPanFromGstin("29ABCPK1234F1Z5")).toBe("ABCPK1234F");
    expect(extractPanFromGstin("07AABCC1234D1ZA")).toBe("AABCC1234D");
  });
});

describe("derivePanCategory", () => {
  it("returns category code from fourth character", () => {
    expect(derivePanCategory("AABCC1234F")).toBe("C");
    expect(derivePanCategory("ABCPK1234F")).toBe("P");
    expect(derivePanCategory("ABCHK1234F")).toBe("H");
    expect(derivePanCategory("ABCFK1234F")).toBe("F");
    expect(derivePanCategory("ABCTK1234F")).toBe("T");
  });

  it("handles lowercase input", () => {
    expect(derivePanCategory("abcpk1234f")).toBe("P");
  });

  it("returns null for short strings", () => {
    expect(derivePanCategory("ABC")).toBeNull();
    expect(derivePanCategory("")).toBeNull();
  });

  it("returns null for invalid category character", () => {
    expect(derivePanCategory("ABCXK1234F")).toBeNull();
    expect(derivePanCategory("ABCZK1234F")).toBeNull();
  });
});
