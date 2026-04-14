import { TdsCalculationService } from "../TdsCalculationService";
import type { ParsedInvoiceData } from "@/types/invoice";

const service = new TdsCalculationService();

describe("TdsCalculationService", () => {
  describe("getPanCategory", () => {
    it("returns C for company PAN", () => {
      expect(service.getPanCategory("AABCC1234F")).toBe("C");
    });

    it("returns P for individual PAN", () => {
      expect(service.getPanCategory("ABCPK1234F")).toBe("P");
    });

    it("returns H for HUF PAN", () => {
      expect(service.getPanCategory("ABCHK1234F")).toBe("H");
    });

    it("returns F for firm PAN", () => {
      expect(service.getPanCategory("ABCFK1234F")).toBe("F");
    });

    it("returns T for trust PAN", () => {
      expect(service.getPanCategory("ABCTK1234F")).toBe("T");
    });

    it("returns A, B, L, J, G for other valid categories", () => {
      expect(service.getPanCategory("ABCAK1234F")).toBe("A");
      expect(service.getPanCategory("ABCBK1234F")).toBe("B");
      expect(service.getPanCategory("ABCLK1234F")).toBe("L");
      expect(service.getPanCategory("ABCJK1234F")).toBe("J");
      expect(service.getPanCategory("ABCGK1234F")).toBe("G");
    });

    it("returns null for null or undefined PAN", () => {
      expect(service.getPanCategory(null)).toBeNull();
      expect(service.getPanCategory(undefined)).toBeNull();
    });

    it("returns null for invalid PAN format", () => {
      expect(service.getPanCategory("INVALID")).toBeNull();
      expect(service.getPanCategory("12345")).toBeNull();
      expect(service.getPanCategory("")).toBeNull();
    });

    it("handles lowercase PAN by uppercasing", () => {
      expect(service.getPanCategory("abcpk1234f")).toBe("P");
    });
  });

  describe("calculate", () => {
    it("calculates TDS at 10% (1000 bps) on 100000 minor units", () => {
      const result = service.calculate(10000000, 1000, 11800000);
      expect(result.tdsAmountMinor).toBe(1000000);
      expect(result.netPayableMinor).toBe(10800000);
    });

    it("calculates TDS at 2% (200 bps)", () => {
      const result = service.calculate(5000000, 200, 5000000);
      expect(result.tdsAmountMinor).toBe(100000);
      expect(result.netPayableMinor).toBe(4900000);
    });

    it("calculates TDS at 1% (100 bps)", () => {
      const result = service.calculate(5000000, 100, 5000000);
      expect(result.tdsAmountMinor).toBe(50000);
      expect(result.netPayableMinor).toBe(4950000);
    });

    it("calculates TDS at 20% no-PAN penalty rate (2000 bps)", () => {
      const result = service.calculate(10000000, 2000, 10000000);
      expect(result.tdsAmountMinor).toBe(2000000);
      expect(result.netPayableMinor).toBe(8000000);
    });

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
