import {
  formatMinorAmountWithCurrency,
  minorUnitsToMajorString
} from "@/lib/common/currency.ts";

describe("currency helpers", () => {
  it("respects minor-unit digits per currency via minorUnitsToMajorString", () => {
    expect(minorUnitsToMajorString(100, "USD")).toBe("1.00");
    expect(minorUnitsToMajorString(100, "JPY")).toBe("100");
    expect(minorUnitsToMajorString(1000, "BHD")).toBe("1.000");
    expect(minorUnitsToMajorString(100, "xyz")).toBe("1.00");
    expect(minorUnitsToMajorString(100, undefined)).toBe("1.00");
  });

  it("formats minor units into major-unit strings without floating math", () => {
    expect(minorUnitsToMajorString(123456, "USD")).toBe("1234.56");
    expect(minorUnitsToMajorString(1234, "JPY")).toBe("1234");
    expect(minorUnitsToMajorString(-5432, "BHD")).toBe("-5.432");
  });

  it("formats display labels with currency symbol", () => {
    expect(formatMinorAmountWithCurrency(120050, "USD")).toBe("$1,200.50");
    expect(formatMinorAmountWithCurrency(5000, "JPY")).toBe("\u00A55,000");
    expect(formatMinorAmountWithCurrency(5000, undefined)).toBe("\u20B950.00");
    expect(formatMinorAmountWithCurrency(undefined, "USD")).toBe("-");
    expect(formatMinorAmountWithCurrency(13000, "INR")).toBe("\u20B9130.00");
  });
});
