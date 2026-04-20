import { isValidGstinFormat, isValidPanFormat, extractPanFromGstin, doesPanMatchGstin } from "./taxIdValidation";

describe("isValidGstinFormat", () => {
  it("returns true for valid GSTIN", () => {
    expect(isValidGstinFormat("27AADCB2230M1Z3")).toBe(true);
  });

  it("returns false for invalid GSTIN", () => {
    expect(isValidGstinFormat("INVALID")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isValidGstinFormat(null)).toBe(false);
    expect(isValidGstinFormat(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidGstinFormat("")).toBe(false);
  });

  it("handles lowercase input", () => {
    expect(isValidGstinFormat("27aadcb2230m1z3")).toBe(true);
  });
});

describe("isValidPanFormat", () => {
  it("returns true for valid PAN", () => {
    expect(isValidPanFormat("AADCB2230M")).toBe(true);
  });

  it("returns false for invalid PAN", () => {
    expect(isValidPanFormat("123456")).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(isValidPanFormat(null)).toBe(false);
    expect(isValidPanFormat(undefined)).toBe(false);
  });

  it("handles lowercase input", () => {
    expect(isValidPanFormat("aadcb2230m")).toBe(true);
  });
});

describe("extractPanFromGstin", () => {
  it("extracts PAN from valid GSTIN", () => {
    expect(extractPanFromGstin("27AADCB2230M1Z3")).toBe("AADCB2230M");
  });

  it("returns null for invalid GSTIN", () => {
    expect(extractPanFromGstin("INVALID")).toBeNull();
  });

  it("returns null for null/undefined", () => {
    expect(extractPanFromGstin(null)).toBeNull();
    expect(extractPanFromGstin(undefined)).toBeNull();
  });
});

describe("doesPanMatchGstin", () => {
  it("returns true when PAN matches GSTIN", () => {
    expect(doesPanMatchGstin("AADCB2230M", "27AADCB2230M1Z3")).toBe(true);
  });

  it("returns false when PAN does not match GSTIN", () => {
    expect(doesPanMatchGstin("ZZZZZ9999Z", "27AADCB2230M1Z3")).toBe(false);
  });

  it("returns false when either is null", () => {
    expect(doesPanMatchGstin(null, "27AADCB2230M1Z3")).toBe(false);
    expect(doesPanMatchGstin("AADCB2230M", null)).toBe(false);
  });
});
