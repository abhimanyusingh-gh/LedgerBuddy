import { determineFY, determineQuarter, TDS_QUARTER } from "@/services/tds/fiscalYearUtils.js";

describe("fiscalYearUtils", () => {
  describe("determineFY (IST anchored, D-043 / C-002)", () => {
    it("returns previous-year FY for January in IST", () => {
      expect(determineFY(new Date("2026-01-15T05:30:00+05:30"))).toBe("2025-26");
    });

    it("returns previous-year FY for March 1 in IST", () => {
      expect(determineFY(new Date("2026-03-01T10:00:00+05:30"))).toBe("2025-26");
    });

    it("returns next-year FY for April 1 in IST", () => {
      expect(determineFY(new Date("2026-04-01T00:00:00+05:30"))).toBe("2026-27");
    });

    it("returns next-year FY for December in IST", () => {
      expect(determineFY(new Date("2026-12-31T23:59:59+05:30"))).toBe("2026-27");
    });

    it("RFC §7.1 case 13: March 31 23:00 UTC = April 1 04:30 IST → next FY", () => {
      const date = new Date("2026-03-31T23:00:00Z");
      expect(determineFY(date)).toBe("2026-27");
      expect(determineQuarter(date)).toBe(TDS_QUARTER.Q1);
    });

    it("RFC §7.1 case 14: March 31 18:00 UTC = March 31 23:30 IST → still current FY", () => {
      const date = new Date("2026-03-31T18:00:00Z");
      expect(determineFY(date)).toBe("2025-26");
      expect(determineQuarter(date)).toBe(TDS_QUARTER.Q4);
    });

    it("formats single-digit FY end years with leading zero", () => {
      expect(determineFY(new Date("2009-04-15T05:30:00+05:30"))).toBe("2009-10");
      expect(determineFY(new Date("2008-12-15T05:30:00+05:30"))).toBe("2008-09");
    });

    it("rolls over century boundary", () => {
      expect(determineFY(new Date("2099-04-01T05:30:00+05:30"))).toBe("2099-00");
      expect(determineFY(new Date("2100-03-31T18:00:00+05:30"))).toBe("2099-00");
    });

    it("throws on invalid date", () => {
      expect(() => determineFY(new Date("not-a-date"))).toThrow(RangeError);
    });
  });

  describe("determineQuarter (D-026 / C-014)", () => {
    const expectations: Array<{ month: string; quarter: string }> = [
      { month: "2026-04-01T05:30:00+05:30", quarter: TDS_QUARTER.Q1 },
      { month: "2026-05-15T05:30:00+05:30", quarter: TDS_QUARTER.Q1 },
      { month: "2026-06-30T05:30:00+05:30", quarter: TDS_QUARTER.Q1 },
      { month: "2026-07-01T05:30:00+05:30", quarter: TDS_QUARTER.Q2 },
      { month: "2026-08-15T05:30:00+05:30", quarter: TDS_QUARTER.Q2 },
      { month: "2026-09-30T05:30:00+05:30", quarter: TDS_QUARTER.Q2 },
      { month: "2026-10-01T05:30:00+05:30", quarter: TDS_QUARTER.Q3 },
      { month: "2026-11-15T05:30:00+05:30", quarter: TDS_QUARTER.Q3 },
      { month: "2026-12-31T05:30:00+05:30", quarter: TDS_QUARTER.Q3 },
      { month: "2027-01-01T05:30:00+05:30", quarter: TDS_QUARTER.Q4 },
      { month: "2027-02-15T05:30:00+05:30", quarter: TDS_QUARTER.Q4 },
      { month: "2027-03-31T05:30:00+05:30", quarter: TDS_QUARTER.Q4 }
    ];

    it.each(expectations)("$month → $quarter", ({ month, quarter }) => {
      expect(determineQuarter(new Date(month))).toBe(quarter);
    });
  });
});
