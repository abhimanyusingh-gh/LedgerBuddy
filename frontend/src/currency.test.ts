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

  it("formats display labels with currency code", () => {
    expect(formatMinorAmountWithCurrency(120050, "USD")).toBe("USD 1200.50");
    expect(formatMinorAmountWithCurrency(5000, "JPY")).toBe("JPY 5000");
    expect(formatMinorAmountWithCurrency(5000, undefined)).toBe("50.00");
    expect(formatMinorAmountWithCurrency(undefined, "USD")).toBe("-");
  });
});
