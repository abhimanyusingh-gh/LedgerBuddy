import { TdsCalculationService } from "@/services/compliance/TdsCalculationService";
import type { ParsedInvoiceData } from "@/types/invoice";

const service = new TdsCalculationService();

describe("TdsCalculationService", () => {
  describe("getPanCategory", () => {
    it.each([
      ["AABCC1234F", "C"],
      ["ABCPK1234F", "P"],
      ["ABCHK1234F", "H"],
      ["ABCFK1234F", "F"],
      ["ABCTK1234F", "T"],
      ["ABCAK1234F", "A"],
      ["ABCBK1234F", "B"],
      ["ABCLK1234F", "L"],
      ["ABCJK1234F", "J"],
      ["ABCGK1234F", "G"],
    ])("returns correct category for PAN %s", (pan, expected) => {
      expect(service.getPanCategory(pan)).toBe(expected);
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["invalid string", "INVALID"],
      ["numeric string", "12345"],
      ["empty string", ""],
    ])("returns null for %s PAN", (_label, pan) => {
      expect(service.getPanCategory(pan as string | null | undefined)).toBeNull();
    });

    it("handles lowercase PAN by uppercasing", () => {
      expect(service.getPanCategory("abcpk1234f")).toBe("P");
    });
  });

  describe("calculate", () => {
    it.each([
      ["10% (1000 bps) on 100000 minor units", 10000000, 1000, 11800000, 1000000, 10800000],
      ["2% (200 bps)", 5000000, 200, 5000000, 100000, 4900000],
      ["1% (100 bps)", 5000000, 100, 5000000, 50000, 4950000],
      ["20% no-PAN penalty (2000 bps)", 10000000, 2000, 10000000, 2000000, 8000000],
    ])(
      "calculates TDS at %s",
      (_label, taxable, rateBps, total, expectedTds, expectedNet) => {
        const result = service.calculate(taxable, rateBps, total);
        expect(result.tdsAmountMinor).toBe(expectedTds);
        expect(result.netPayableMinor).toBe(expectedNet);
      }
    );

    it("rounds to nearest integer for fractional amounts", () => {
      const result = service.calculate(3333333, 1000, 3333333);
      expect(result.tdsAmountMinor).toBe(333333);
      expect(Number.isInteger(result.tdsAmountMinor)).toBe(true);
    });

    it("handles zero taxable amount", () => {
      const result = service.calculate(0, 1000, 0);
      expect(result.tdsAmountMinor).toBe(0);
      expect(result.netPayableMinor).toBe(0);
    });

    it("net payable accounts for total including GST", () => {
      const result = service.calculate(10000000, 1000, 11800000);
      expect(result.tdsAmountMinor).toBe(1000000);
      expect(result.netPayableMinor).toBe(10800000);
    });
  });

  describe("determineTaxableAmount", () => {
    it("uses subtotalMinor when available", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 11800000,
        gst: { subtotalMinor: 10000000 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(10000000);
    });

    it("falls back to totalAmountMinor when no subtotal", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000
      };
      expect(service.determineTaxableAmount(invoice)).toBe(5000000);
    });

    it("falls back to totalAmountMinor when subtotal is 0", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000,
        gst: { subtotalMinor: 0 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(5000000);
    });

    it("returns 0 when no amount fields exist", () => {
      const invoice: ParsedInvoiceData = {};
      expect(service.determineTaxableAmount(invoice)).toBe(0);
    });
  });
});
