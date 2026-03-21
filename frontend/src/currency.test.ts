import {
  formatMinorAmountWithCurrency,
  getCurrencyMinorUnitDigits,
  minorUnitsToMajorString
} from "./currency.ts";

describe("currency helpers", () => {
  it("resolves minor-unit digits by currency", () => {
    expect(getCurrencyMinorUnitDigits("USD")).toBe(2);
    expect(getCurrencyMinorUnitDigits("JPY")).toBe(0);
    expect(getCurrencyMinorUnitDigits("BHD")).toBe(3);
    expect(getCurrencyMinorUnitDigits("xyz")).toBe(2);
    expect(getCurrencyMinorUnitDigits(undefined)).toBe(2);
  });

  it("formats minor units into major-unit strings without floating math", () => {
    expect(minorUnitsToMajorString(123456, "USD")).toBe("1234.56");
    expect(minorUnitsToMajorString(1234, "JPY")).toBe("1234");
    expect(minorUnitsToMajorString(-5432, "BHD")).toBe("-5.432");
  });

  it("formats display labels with currency symbol", () => {
    expect(formatMinorAmountWithCurrency(120050, "USD")).toBe("$1200.50");
    expect(formatMinorAmountWithCurrency(5000, "JPY")).toBe("\u00A55000");
    expect(formatMinorAmountWithCurrency(5000, undefined)).toBe("\u20B950.00");
    expect(formatMinorAmountWithCurrency(undefined, "USD")).toBe("-");
    expect(formatMinorAmountWithCurrency(13000, "INR")).toBe("\u20B9130.00");
  });
});
