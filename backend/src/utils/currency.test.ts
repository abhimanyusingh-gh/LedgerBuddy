import {
  getCurrencyMinorUnitDigits,
  isPositiveMinorUnits,
  minorUnitsToMajorString,
  normalizeMinorUnits,
  toMinorUnits
} from "@/utils/currency.ts";

describe("currency utils", () => {
  it("uses expected minor-unit digits per currency", () => {
    expect(getCurrencyMinorUnitDigits("USD")).toBe(2);
    expect(getCurrencyMinorUnitDigits("JPY")).toBe(0);
    expect(getCurrencyMinorUnitDigits("BHD")).toBe(3);
    expect(getCurrencyMinorUnitDigits("ZZZ")).toBe(2);
  });

  it("converts major amount to integer minor units", () => {
    expect(toMinorUnits(1234.56, "USD")).toBe(123456);
    expect(toMinorUnits(1234, "JPY")).toBe(1234);
    expect(toMinorUnits(5.432, "BHD")).toBe(5432);
  });

  it("formats minor units into deterministic major string", () => {
    expect(minorUnitsToMajorString(123456, "USD")).toBe("1234.56");
    expect(minorUnitsToMajorString(1234, "JPY")).toBe("1234");
    expect(minorUnitsToMajorString(-5432, "BHD")).toBe("-5.432");
  });

  it("normalizes and validates minor unit values", () => {
    expect(normalizeMinorUnits(1200.9)).toBe(1200);
    expect(normalizeMinorUnits(undefined)).toBeNull();
    expect(isPositiveMinorUnits(1)).toBe(true);
    expect(isPositiveMinorUnits(0)).toBe(false);
    expect(isPositiveMinorUnits(12.4)).toBe(false);
  });

  it("throws when major amount is non-finite", () => {
    expect(() => toMinorUnits(Number.NaN, "USD")).toThrow("majorAmount must be a finite number.");
  });
});
