import { TdsCalculationService, type TdsLowerDeductionCert } from "@/services/compliance/TdsCalculationService";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger";
import type { ParsedInvoiceData } from "@/types/invoice";
import { TDS_CONFIDENCE, TDS_RATE_SOURCE } from "@/types/invoice";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals";

jest.mock("../../../models/compliance/TdsVendorLedger");

const service = new TdsCalculationService();

const SECTION_194C = "194C";
const ANNUAL_THRESHOLD_194C_MINOR = 1_00_000_00;
const APRIL_15_IST = new Date("2026-04-15T05:30:00+05:30");
const MARCH_31_UTC_LATE = new Date("2026-03-31T23:00:00Z");
const MARCH_31_UTC_EARLY = new Date("2026-03-31T10:00:00Z");
const NOW_FY_2026_27 = new Date("2026-06-01T00:00:00Z");

interface RateLookupOpts {
  rateBps?: number;
  thresholdSingleMinor?: number;
  thresholdAnnualMinor?: number;
  source?: "tenant" | "rateTable";
}

function makeRateLookup(opts: RateLookupOpts = {}) {
  return {
    rateBps: opts.rateBps ?? 100,
    thresholdSingleMinor: opts.thresholdSingleMinor ?? 0,
    thresholdAnnualMinor: opts.thresholdAnnualMinor ?? ANNUAL_THRESHOLD_194C_MINOR,
    source: opts.source ?? "rateTable" as const
  };
}

function makeDetection(
  section: string | null = SECTION_194C,
  confidence: typeof TDS_CONFIDENCE[keyof typeof TDS_CONFIDENCE] = TDS_CONFIDENCE.HIGH
) {
  return { section, confidence };
}

function basicInvoice(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    totalAmountMinor: 50_000_00,
    currency: "INR",
    pan: "ABCPK1234F",
    invoiceDate: APRIL_15_IST,
    ...overrides
  };
}

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
    it("uses subtotalMinor when GST shown separately (CBDT 23/2017, C-008, RFC §7.1 case 15)", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 11800000,
        gst: { subtotalMinor: 10000000, cgstMinor: 900000, sgstMinor: 900000 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(10000000);
    });

    it("computes taxable base = total - totalGst when GST separate but subtotal absent", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 11800000,
        gst: { cgstMinor: 900000, sgstMinor: 900000 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(10000000);
    });

    it("returns full total when GST not shown separately (C-015, RFC §7.1 case 16)", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000,
        gst: { gstin: "27ABCDE1234F1Z5" }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(5000000);
    });

    it("falls back to totalAmountMinor when no gst block", () => {
      const invoice: ParsedInvoiceData = { totalAmountMinor: 5000000 };
      expect(service.determineTaxableAmount(invoice)).toBe(5000000);
    });

    it("returns 0 when no amount fields exist", () => {
      const invoice: ParsedInvoiceData = {};
      expect(service.determineTaxableAmount(invoice)).toBe(0);
    });

    it("clamps taxable base to >=0 when GST exceeds total", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 100,
        gst: { cgstMinor: 200, sgstMinor: 200, igstMinor: 0, cessMinor: 0 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(0);
    });

    it("includes cess and igst in totalGst computation", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 1_18_500_00,
        gst: { igstMinor: 18_000_00, cessMinor: 500_00 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(1_00_000_00);
    });

    it("treats only cgst > 0 as GST shown separately", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 1_09_000_00,
        gst: { cgstMinor: 9_000_00 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(1_00_000_00);
    });

    it("treats explicit zero cgst with positive sgst as separately shown", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 1_09_000_00,
        gst: { cgstMinor: 0, sgstMinor: 9_000_00 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(1_00_000_00);
    });

    it("uses subtotalMinor when GST present but components zero", () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5_000_00,
        gst: { subtotalMinor: 4_500_00 }
      };
      expect(service.determineTaxableAmount(invoice)).toBe(4_500_00);
    });
  });

  describe("computeTds purity (PA-01, C-020)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("never writes to TdsVendorLedger from inside computeTds", () => {
      service.computeTds({
        invoice: basicInvoice(),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup(),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(TdsVendorLedgerModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(TdsVendorLedgerModel.findOne).not.toHaveBeenCalled();
      expect(TdsVendorLedgerModel.updateOne).not.toHaveBeenCalled();
    });

    it("returns identical ledgerDelta on repeated calls with same inputs (deterministic)", () => {
      const args = {
        invoice: basicInvoice({ totalAmountMinor: 1_50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup(),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      };
      const a = service.computeTds(args);
      const b = service.computeTds(args);
      expect(a.ledgerDelta).toEqual(b.ledgerDelta);
      expect(a.tds).toEqual(b.tds);
    });
  });

  describe("RFC §7.1 cumulative threshold scenarios", () => {
    beforeEach(() => jest.clearAllMocks());

    it("case 1 — below threshold, no prior invoices → TDS=0 + TDS_BELOW_ANNUAL_THRESHOLD", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup(),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.amountMinor).toBe(0);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(false);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_BELOW_ANNUAL_THRESHOLD)).toBe(true);
    });

    it("case 2 — exactly at threshold (cumulative === annual) → no TDS (SR-04: \"exceeds\")", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: ANNUAL_THRESHOLD_194C_MINOR }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup(),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.amountMinor).toBe(0);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(false);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_BELOW_ANNUAL_THRESHOLD)).toBe(true);
    });

    it("case 3 — above threshold, normal per-txn TDS, no signal", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 20_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 1_50_000_00, cumulativeTdsMinor: 50_00 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.amountMinor).toBe(20_000);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(false);
      expect(result.riskSignals.find(s => s.code === RISK_SIGNAL_CODE.TDS_ANNUAL_THRESHOLD_CROSSED)).toBeUndefined();
    });

    it("case 4 — threshold crossing with catch-up: TDS = round(cumulative * rate) - prior TDS", () => {
      const previousCumulative = 90_000_00;
      const thisInvoice = 30_000_00;
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: thisInvoice }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: previousCumulative, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      const newCumulative = previousCumulative + thisInvoice;
      const expectedGross = Math.round(newCumulative * 100 / 10000);
      expect(result.tds.amountMinor).toBe(expectedGross);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(true);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_ANNUAL_THRESHOLD_CROSSED)).toBe(true);
    });

    it("case 5 — backdated invoice (prior FY) emits TDS_BACKDATED_THRESHOLD_ADJUSTMENT", () => {
      const backdated = new Date("2024-05-01T00:00:00Z");
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 1_50_000_00, invoiceDate: backdated }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.quarter).toBe("Q1");
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_BACKDATED_THRESHOLD_ADJUSTMENT)).toBe(true);
    });

    it("case 6 — multiple sections per vendor: only crossed section triggers (per-section ledger)", () => {
      const r194c = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 1_50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(SECTION_194C),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      const r194j = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 10_000_00 }),
        glCategory: "Professional Services",
        rateLookup: makeRateLookup({ rateBps: 1000, thresholdAnnualMinor: 30_000_00 }),
        detection: makeDetection("194J"),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(r194c.ledgerDelta.thresholdJustCrossed).toBe(true);
      expect(r194j.ledgerDelta.thresholdJustCrossed).toBe(false);
      expect(r194j.tds.amountMinor).toBe(0);
    });

    it("case 7 — Section 197 cert valid + within maxAmount → cert rate applied + TDS_SECTION_197_APPLIED", () => {
      const cert: TdsLowerDeductionCert = {
        certificateNumber: "CERT-1",
        section: SECTION_194C,
        applicableRateBps: 50,
        validFrom: new Date("2026-04-01T00:00:00Z"),
        validTo: new Date("2027-03-31T23:59:59Z"),
        financialYear: "2026-27",
        maxAmountMinor: 5_00_000_00
      };
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        vendorCert: cert,
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.SECTION_197);
      expect(result.tds.rateBps).toBe(50);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_SECTION_197_APPLIED)).toBe(true);
    });

    it("case 8 — Section 197 cert expired → standard rate", () => {
      const expired: TdsLowerDeductionCert = {
        certificateNumber: "CERT-X",
        section: SECTION_194C,
        applicableRateBps: 50,
        validFrom: new Date("2025-04-01T00:00:00Z"),
        validTo: new Date("2025-12-31T23:59:59Z"),
        financialYear: "2025-26",
        maxAmountMinor: 5_00_000_00
      };
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        vendorCert: expired,
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.STANDARD);
      expect(result.tds.rateBps).toBe(100);
    });

    it("case 9 — Section 197 cert exhausted (cumulative >= maxAmount) → standard rate", () => {
      const exhaustedByCumulative: TdsLowerDeductionCert = {
        certificateNumber: "CERT-2",
        section: SECTION_194C,
        applicableRateBps: 50,
        validFrom: new Date("2026-04-01T00:00:00Z"),
        validTo: new Date("2027-03-31T23:59:59Z"),
        financialYear: "2026-27",
        maxAmountMinor: 1_00_000_00
      };
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 1_00_000_00, cumulativeTdsMinor: 50_00 },
        vendorCert: exhaustedByCumulative,
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.STANDARD);
    });

    it("case 10 — no PAN → 206AA penalty: rate = max(20%, 2*standard) + TDS_NO_PAN_PENALTY_RATE", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00, pan: undefined }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.NO_PAN_206AA);
      expect(result.tds.rateBps).toBe(2000);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE)).toBe(true);
    });

    it("case 11 — no PAN with valid Section 197 → cert priority wins (both signals possible)", () => {
      const cert: TdsLowerDeductionCert = {
        certificateNumber: "CERT-3",
        section: SECTION_194C,
        applicableRateBps: 75,
        validFrom: new Date("2026-04-01T00:00:00Z"),
        validTo: new Date("2027-03-31T23:59:59Z"),
        financialYear: "2026-27",
        maxAmountMinor: 5_00_000_00
      };
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00, pan: undefined }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        vendorCert: cert,
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.SECTION_197);
      expect(result.tds.rateBps).toBe(75);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_SECTION_197_APPLIED)).toBe(true);
    });

    it("case 13 — FY boundary: March 31 23:00 UTC is April 1 IST → next FY", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00, invoiceDate: MARCH_31_UTC_LATE }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.quarter).toBe("Q1");
    });

    it("case 14 — FY boundary: March 31 10:00 UTC is still March in IST → current/prior FY", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00, invoiceDate: MARCH_31_UTC_EARLY }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.quarter).toBe("Q4");
    });

    it("case 15 — GST shown separately → taxableBase excludes GST", () => {
      const result = service.computeTds({
        invoice: {
          totalAmountMinor: 1_18_000_00,
          gst: { subtotalMinor: 1_00_000_00, cgstMinor: 9_000_00, sgstMinor: 9_000_00 },
          pan: "ABCPK1234F",
          invoiceDate: APRIL_15_IST
        },
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 99_999_00 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.taxableBaseMinor).toBe(1_00_000_00);
    });

    it("case 16 — GST not shown separately → taxableBase = totalAmount", () => {
      const result = service.computeTds({
        invoice: {
          totalAmountMinor: 1_18_000_00,
          gst: { gstin: "27ABCDE1234F1Z5" },
          pan: "ABCPK1234F",
          invoiceDate: APRIL_15_IST
        },
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 99_999_00 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.taxableBaseMinor).toBe(1_18_000_00);
    });

    it("case 17 — zero taxable amount → no TDS, early return", () => {
      const result = service.computeTds({
        invoice: { totalAmountMinor: 0, pan: "ABCPK1234F", invoiceDate: APRIL_15_IST },
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.amountMinor).toBeNull();
      expect(result.ledgerDelta.taxableAmountMinor).toBe(0);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(false);
    });

    it("case 18 — tenant override rate produces rateSource=TENANT_OVERRIDE", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 75, source: "tenant" }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 1_00_001_00, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).toBe(TDS_RATE_SOURCE.TENANT_OVERRIDE);
      expect(result.tds.rateBps).toBe(75);
    });

    it("case 20 — single-txn below but cumulative crosses annual → catch-up TDS", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 20_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdSingleMinor: 30_000_00, thresholdAnnualMinor: ANNUAL_THRESHOLD_194C_MINOR }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 90_000_00, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(true);
      expect(result.tds.amountMinor).toBeGreaterThan(0);
    });

    it.each<[string, string, "Q1" | "Q2" | "Q3" | "Q4"]>([
      ["April", "2026-04-15T05:30:00+05:30", "Q1"],
      ["May", "2026-05-15T05:30:00+05:30", "Q1"],
      ["June", "2026-06-30T18:00:00+05:30", "Q1"],
      ["July", "2026-07-01T06:00:00+05:30", "Q2"],
      ["August", "2026-08-15T05:30:00+05:30", "Q2"],
      ["September", "2026-09-30T05:30:00+05:30", "Q2"],
      ["October", "2026-10-01T06:00:00+05:30", "Q3"],
      ["November", "2026-11-15T05:30:00+05:30", "Q3"],
      ["December", "2026-12-15T05:30:00+05:30", "Q3"],
      ["January", "2027-01-15T05:30:00+05:30", "Q4"],
      ["February", "2027-02-15T05:30:00+05:30", "Q4"],
      ["March", "2027-03-15T05:30:00+05:30", "Q4"],
    ])("case 22 — quarter assignment for %s in IST → %s", (_label, iso, expected) => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00, invoiceDate: new Date(iso) }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 0 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.quarter).toBe(expected);
    });

    it("case 23 — catch-up with rate variance emits TDS_CATCHUP_RATE_VARIANCE", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 30_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 1500 }),
        detection: makeDetection(),
        cumulative: {
          cumulativeBaseMinor: 90_000_00,
          cumulativeTdsMinor: 0,
          entries: [{ rateBps: 1000 }, { rateBps: 1000 }]
        },
        now: NOW_FY_2026_27
      });
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_CATCHUP_RATE_VARIANCE)).toBe(true);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_ANNUAL_THRESHOLD_CROSSED)).toBe(true);
    });

    it("case 24 — exact threshold boundary (cumulative === annual) → no TDS (SR-04)", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 10_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: ANNUAL_THRESHOLD_194C_MINOR }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 90_000_00, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.amountMinor).toBe(0);
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_BELOW_ANNUAL_THRESHOLD)).toBe(true);
      expect(result.ledgerDelta.thresholdJustCrossed).toBe(false);
    });

    it("returns null tds when section is not detected (early exit)", () => {
      const result = service.computeTds({
        invoice: basicInvoice(),
        glCategory: null,
        rateLookup: null,
        detection: makeDetection(null, TDS_CONFIDENCE.LOW),
        cumulative: null,
        now: NOW_FY_2026_27
      });
      expect(result.tds.section).toBeNull();
      expect(result.ledgerDelta.taxableAmountMinor).toBe(0);
    });

    it("returns null rate when rateLookup is null (section detected but no rate row)", () => {
      const result = service.computeTds({
        invoice: basicInvoice(),
        glCategory: "Contractor Services",
        rateLookup: null,
        detection: makeDetection(),
        cumulative: null,
        now: NOW_FY_2026_27
      });
      expect(result.tds.section).toBe(SECTION_194C);
      expect(result.tds.rateBps).toBeNull();
    });

    it("emits TDS_SECTION_AMBIGUOUS when detection confidence is medium", () => {
      const result = service.computeTds({
        invoice: basicInvoice(),
        glCategory: "Ambiguous Category",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(SECTION_194C, TDS_CONFIDENCE.MEDIUM),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_SECTION_AMBIGUOUS)).toBe(true);
    });

    it("uses totalAmount as fallback when invoice.totalAmountMinor is undefined and gst gives taxable", () => {
      const result = service.computeTds({
        invoice: { gst: { subtotalMinor: 50_000_00 }, pan: "ABCPK1234F", invoiceDate: APRIL_15_IST },
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 0 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      expect(result.tds.taxableBaseMinor).toBe(50_000_00);
    });

    it("uses evaluatedNow when invoice.invoiceDate is missing", () => {
      const result = service.computeTds({
        invoice: { totalAmountMinor: 50_000_00, pan: "ABCPK1234F" },
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 0 }),
        detection: makeDetection(),
        cumulative: null,
        now: NOW_FY_2026_27
      });
      expect(result.tds.quarter).toBe("Q1");
    });

    it("defaults `now` to current Date when not supplied", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100, thresholdAnnualMinor: 0 }),
        detection: makeDetection(),
        cumulative: null
      });
      expect(["Q1", "Q2", "Q3", "Q4"]).toContain(result.tds.quarter);
    });

    it("206AA does not include rate-variance signal when entries set has size 1 matching current rate", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 30_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: {
          cumulativeBaseMinor: 90_000_00,
          cumulativeTdsMinor: 0,
          entries: [{ rateBps: 100 }, { rateBps: 100 }]
        },
        now: NOW_FY_2026_27
      });
      expect(result.riskSignals.find(s => s.code === RISK_SIGNAL_CODE.TDS_CATCHUP_RATE_VARIANCE)).toBeUndefined();
      expect(result.riskSignals.some(s => s.code === RISK_SIGNAL_CODE.TDS_ANNUAL_THRESHOLD_CROSSED)).toBe(true);
    });

    it("Section 197 cert with exhaustedAt set is ignored", () => {
      const cert: TdsLowerDeductionCert = {
        certificateNumber: "CERT-EXH",
        section: SECTION_194C,
        applicableRateBps: 50,
        validFrom: new Date("2026-04-01T00:00:00Z"),
        validTo: new Date("2027-03-31T23:59:59Z"),
        financialYear: "2026-27",
        maxAmountMinor: 5_00_000_00,
        exhaustedAt: new Date("2026-05-01T00:00:00Z")
      };
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        vendorCert: cert,
        now: NOW_FY_2026_27
      });
      expect(result.tds.rateSource).not.toBe(TDS_RATE_SOURCE.SECTION_197);
    });

    it("206AA emits PAN-present-but-invalid penalty message variant", () => {
      const result = service.computeTds({
        invoice: basicInvoice({ totalAmountMinor: 2_00_000_00, pan: "INVALID-PAN" }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 0, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      });
      const signal = result.riskSignals.find(s => s.code === RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE);
      expect(signal).toBeDefined();
      expect(signal?.message).toMatch(/No valid PAN/i);
    });
  });

  describe("perf: TDS compute p95 < 200ms (NFR-001)", () => {
    it("p95 of 200 invocations is under 200ms", () => {
      const args = {
        invoice: basicInvoice({ totalAmountMinor: 1_50_000_00 }),
        glCategory: "Contractor Services",
        rateLookup: makeRateLookup({ rateBps: 100 }),
        detection: makeDetection(),
        cumulative: { cumulativeBaseMinor: 50_000_00, cumulativeTdsMinor: 0 },
        now: NOW_FY_2026_27
      };
      const N = 200;
      const samples: number[] = [];
      for (let i = 0; i < N; i += 1) {
        const start = process.hrtime.bigint();
        service.computeTds(args);
        const end = process.hrtime.bigint();
        samples.push(Number(end - start) / 1_000_000);
      }
      samples.sort((a, b) => a - b);
      const p95 = samples[Math.floor(N * 0.95)];
      expect(p95).toBeLessThan(200);
    });
  });
});
