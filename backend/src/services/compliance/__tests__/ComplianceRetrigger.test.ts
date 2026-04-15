import { TdsCalculationService } from "@/services/compliance/TdsCalculationService";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping";
import { TdsRateTableModel } from "@/models/compliance/TdsRateTable";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig";
import type { ParsedInvoiceData } from "@/types/invoice";

jest.mock("../../../models/compliance/TdsSectionMapping");
jest.mock("../../../models/compliance/TdsRateTable");
jest.mock("../../../models/integration/TenantComplianceConfig");

const tdsService = new TdsCalculationService();

function mockSectionMapping(section: string, priority = 10) {
  (TdsSectionMappingModel.find as jest.Mock).mockReturnValue({
    sort: () => ({ limit: () => ({ lean: () => Promise.resolve([{ tdsSection: section, priority }]) }) })
  });
}

function mockNoTenantConfig() {
  (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
    lean: () => Promise.resolve(null)
  });
}

function mockTenantConfigWithRates(rates: object[]) {
  (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
    lean: () => Promise.resolve({ tdsRates: rates })
  });
}

describe("Compliance Retrigger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("TDS calculation with new GL category", () => {
    it("returns low confidence when glCategory is null", async () => {
      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", null);
      expect(result.tds.section).toBeNull();
      expect(result.tds.confidence).toBe("low");
    });

    it("returns section null when no mapping found for category", async () => {
      (TdsSectionMappingModel.find as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) })
      });

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Nonexistent Category");
      expect(result.tds.section).toBeNull();
      expect(result.tds.confidence).toBe("low");
    });

    it("falls back to TdsRateTable when tenant has no configured rates", async () => {
      mockSectionMapping("194J");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000,
          rateCompanyBps: 1000,
          rateNoPanBps: 2000,
          thresholdSingleMinor: 3000000,
          thresholdAnnualMinor: 0,
          isActive: true
        })
      });

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Professional Services");
      expect(result.tds.section).toBe("194J");
      expect(result.tds.confidence).toBe("high");
      expect(result.tds.rate).toBe(2000);
      expect(result.tds.source).toBe("auto");
    });

    it("uses configured rate from tenant compliance config instead of TdsRateTable", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 800, rateCompany: 800, rateNoPan: 2000, threshold: 0, active: true }
      ]);

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR",
        pan: "ABCPK1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Professional Services");
      expect(result.tds.section).toBe("194J");
      expect(result.tds.rate).toBe(800);
      expect(result.tds.amountMinor).toBe(800000);
      expect(result.tds.netPayableMinor).toBe(9200000);
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("uses rateCompany from tenant config when panCategory is C", async () => {
      mockSectionMapping("194C");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 300, rateNoPan: 2000, threshold: 0, active: true }
      ]);

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000,
        currency: "INR",
        pan: "AABCC1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Contractor Services");
      expect(result.tds.section).toBe("194C");
      expect(result.tds.rate).toBe(300);
      expect(result.tds.amountMinor).toBe(150000);
    });

    it("uses rateNoPan from tenant config when PAN is missing", async () => {
      mockSectionMapping("194C");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 200, rateNoPan: 1500, threshold: 0, active: true }
      ]);

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000,
        currency: "INR"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Contractor Services");
      expect(result.tds.section).toBe("194C");
      expect(result.tds.rate).toBe(1500);
      expect(result.tds.amountMinor).toBe(750000);
    });

    it("returns null rate and zero TDS when section is disabled in tenant config", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 0, active: false }
      ]);

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR",
        pan: "ABCPK1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Professional Services");
      expect(result.tds.section).toBe("194J");
      expect(result.tds.rate).toBeNull();
      expect(result.tds.amountMinor).toBeNull();
      expect(result.tds.netPayableMinor).toBeNull();
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("respects configured threshold from tenant config", async () => {
      mockSectionMapping("194C");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 5000000, active: true }
      ]);

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 3000000,
        currency: "INR",
        pan: "ABCPK1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Contractor Services");
      expect(result.tds.amountMinor).toBe(0);
      expect(result.tds.netPayableMinor).toBe(3000000);
      expect(result.riskSignals.some(s => s.code === "TDS_BELOW_THRESHOLD")).toBe(true);
    });

    it("falls back to TdsRateTable when tenant config has no entry for the matched section", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 0, active: true }
      ]);
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000,
          rateCompanyBps: 1000,
          rateNoPanBps: 2000,
          thresholdSingleMinor: 0,
          thresholdAnnualMinor: 0,
          isActive: true
        })
      });

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR",
        pan: "ABCPK1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Professional Services");
      expect(result.tds.section).toBe("194J");
      expect(result.tds.rate).toBe(1000);
      expect(TdsRateTableModel.findOne).toHaveBeenCalled();
    });

    it("recalculates TDS amount when GL category changes from Rent to Professional Services", async () => {
      mockSectionMapping("194J");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000,
          rateCompanyBps: 1000,
          rateNoPanBps: 2000,
          thresholdSingleMinor: 0,
          thresholdAnnualMinor: 0,
          isActive: true
        })
      });

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 10000000,
        currency: "INR",
        pan: "ABCPK1234F"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Professional Services");
      expect(result.tds.section).toBe("194J");
      expect(result.tds.rate).toBe(1000);
      expect(result.tds.amountMinor).toBe(1000000);
      expect(result.tds.netPayableMinor).toBe(9000000);
    });

    it("generates no-PAN risk signal when PAN is missing and section found", async () => {
      mockSectionMapping("194C");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194C",
          rateIndividualBps: 200,
          rateCompanyBps: 200,
          rateNoPanBps: 2000,
          thresholdSingleMinor: 0,
          thresholdAnnualMinor: 0,
          isActive: true
        })
      });

      const invoice: ParsedInvoiceData = {
        totalAmountMinor: 5000000,
        currency: "INR"
      };
      const result = await tdsService.computeTds(invoice, "tenant-1", "Contractor Services");
      expect(result.tds.section).toBe("194C");
      expect(result.riskSignals.some(s => s.code === "TDS_NO_PAN_PENALTY_RATE")).toBe(true);
    });
  });

  describe("lookupRate", () => {
    it("returns tenant config rate when tenant has matching active section", async () => {
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 750, rateCompany: 750, rateNoPan: 2000, threshold: 0, active: true }
      ]);

      const result = await tdsService.lookupRate("194J", "P", "tenant-1");
      expect(result).not.toBeNull();
      expect(result!.rateBps).toBe(750);
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("returns null when section is marked inactive in tenant config", async () => {
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 0, active: false }
      ]);

      const result = await tdsService.lookupRate("194J", "P", "tenant-1");
      expect(result).toBeNull();
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("falls back to TdsRateTable when tenantId is omitted", async () => {
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000,
          rateCompanyBps: 1000,
          rateNoPanBps: 2000,
          thresholdSingleMinor: 0,
          thresholdAnnualMinor: 0,
          isActive: true
        })
      });

      const result = await tdsService.lookupRate("194J", "P");
      expect(result).not.toBeNull();
      expect(result!.rateBps).toBe(1000);
      expect(TenantComplianceConfigModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe("calculate", () => {
    it("returns correct TDS amount with new rate", () => {
      const result = tdsService.calculate(10000000, 1000, 11800000);
      expect(result.tdsAmountMinor).toBe(1000000);
      expect(result.netPayableMinor).toBe(10800000);
    });

    it("calculate at 2% rate for contractor services", () => {
      const result = tdsService.calculate(5000000, 200, 5900000);
      expect(result.tdsAmountMinor).toBe(100000);
      expect(result.netPayableMinor).toBe(5800000);
    });
  });
});
