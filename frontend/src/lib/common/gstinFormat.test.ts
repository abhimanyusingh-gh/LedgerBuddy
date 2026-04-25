import { GSTIN_FORMAT, isValidGstinFormat, readGstinStatePrefix } from "@/lib/common/gstinFormat";

describe("lib/common/gstinFormat", () => {
  describe("GSTIN_FORMAT regex", () => {
    it.each([
      "29ABCPK1234F1Z5",
      "07AABCC1234D1ZA",
      "33AAACR4849R1ZL"
    ])("matches valid GSTIN %s", (gstin) => {
      expect(GSTIN_FORMAT.test(gstin)).toBe(true);
    });

    it.each([
      ["empty string", ""],
      ["wrong length", "29ABCPK1234F1Z"],
      ["lowercase letters", "29abcpk1234f1z5"],
      ["missing the entity-type Z marker", "29ABCPK1234F1X5"],
      ["leading non-digit", "AB29CPK1234F1Z5"]
    ])("rejects %s", (_label, gstin) => {
      expect(GSTIN_FORMAT.test(gstin)).toBe(false);
    });
  });

  describe("isValidGstinFormat", () => {
    it("returns true for a well-formed GSTIN and false otherwise", () => {
      expect(isValidGstinFormat("29ABCPK1234F1Z5")).toBe(true);
      expect(isValidGstinFormat("nope")).toBe(false);
    });
  });

  describe("readGstinStatePrefix", () => {
    it("returns the 2-digit state code prefix when the GSTIN starts with two digits", () => {
      expect(readGstinStatePrefix("29ABCPK1234F1Z5")).toBe("29");
      expect(readGstinStatePrefix("07")).toBe("07");
    });

    it("returns null when the input is too short or non-numeric in the prefix", () => {
      expect(readGstinStatePrefix("2")).toBeNull();
      expect(readGstinStatePrefix("AB")).toBeNull();
      expect(readGstinStatePrefix("")).toBeNull();
    });
  });
});
