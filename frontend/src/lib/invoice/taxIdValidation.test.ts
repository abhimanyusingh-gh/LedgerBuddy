import { isValidGstinFormat, isValidPanFormat, extractPanFromGstin, doesPanMatchGstin } from "./taxIdValidation";

describe("isValidGstinFormat", () => {
  it.each([
    ["valid GSTIN", "27AADCB2230M1Z3", true],
    ["invalid string", "INVALID", false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["lowercase valid", "27aadcb2230m1z3", true],
    ["too short", "27AADCB", false],
  ])("%s", (_label, input, expected) => {
    expect(isValidGstinFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe("isValidPanFormat", () => {
  it.each([
    ["valid PAN", "AADCB2230M", true],
    ["invalid numeric", "123456", false],
    ["null", null, false],
    ["undefined", undefined, false],
    ["empty string", "", false],
    ["lowercase valid", "aadcb2230m", true],
    ["too short", "AADCB", false],
  ])("%s", (_label, input, expected) => {
    expect(isValidPanFormat(input as string | null | undefined)).toBe(expected);
  });
});

describe("extractPanFromGstin", () => {
  it.each([
    ["valid GSTIN", "27AADCB2230M1Z3", "AADCB2230M"],
    ["invalid GSTIN", "INVALID", null],
    ["null", null, null],
    ["undefined", undefined, null],
    ["empty string", "", null],
  ])("%s", (_label, input, expected) => {
    expect(extractPanFromGstin(input as string | null | undefined)).toBe(expected);
  });
});

describe("doesPanMatchGstin", () => {
  it.each([
    ["matching PAN", "AADCB2230M", "27AADCB2230M1Z3", true],
    ["mismatching PAN", "ZZZZZ9999Z", "27AADCB2230M1Z3", false],
    ["null PAN", null, "27AADCB2230M1Z3", false],
    ["null GSTIN", "AADCB2230M", null, false],
    ["both null", null, null, false],
    ["empty strings", "", "", false],
  ])("%s", (_label, pan, gstin, expected) => {
    expect(doesPanMatchGstin(pan as string | null, gstin as string | null)).toBe(expected);
  });
});
