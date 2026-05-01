import { Types } from "mongoose";
import { TdsCalculationService } from "@/services/compliance/TdsCalculationService";
import { TdsVendorLedgerService } from "@/services/tds/TdsVendorLedgerService";
import { runTdsOrchestrator } from "@/services/compliance/tdsOrchestrator";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping";
import { TdsRateTableModel } from "@/models/compliance/TdsRateTable";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger";
import { resolveTdsRatesConfig } from "@/services/compliance/clientConfigResolver";
import type { ParsedInvoiceData } from "@/types/invoice";

const CLIENT_ORG_ID = new Types.ObjectId("65f0000000000000000000d3");
const VENDOR = "vendor-acme";
const INVOICE_ID = "invoice-1";

jest.mock("../../../models/compliance/TdsSectionMapping");
jest.mock("../../../models/compliance/TdsRateTable");
jest.mock("../../../models/compliance/TdsVendorLedger");
jest.mock("@/services/compliance/clientConfigResolver", () => ({
  resolveTdsRatesConfig: jest.fn()
}));

const tdsService = new TdsCalculationService();
const tdsLedger = new TdsVendorLedgerService();

function mockSectionMapping(section: string, priority = 10) {
  (TdsSectionMappingModel.find as jest.Mock).mockReturnValue({
    sort: () => ({ limit: () => ({ lean: () => Promise.resolve([{ tdsSection: section, priority }]) }) })
  });
}

function mockNoTenantConfig() {
  (resolveTdsRatesConfig as jest.Mock).mockResolvedValue(null);
}

function mockTenantConfigWithRates(rates: object[]) {
  (resolveTdsRatesConfig as jest.Mock).mockResolvedValue({ tdsRates: rates });
}

function mockEmptyLedger() {
  (TdsVendorLedgerModel.findOne as jest.Mock).mockReturnValue({
    lean: () => ({ exec: () => Promise.resolve(null) })
  });
  (TdsVendorLedgerModel.findOneAndUpdate as jest.Mock).mockReturnValue({
    lean: () => ({ exec: () => Promise.resolve({
      cumulativeBaseMinor: 0, cumulativeTdsMinor: 0, invoiceCount: 1,
      thresholdCrossedAt: null, quarter: "Q1", entries: []
    }) })
  });
}

function runOrchestrator(invoice: ParsedInvoiceData, glCategory: string | null, dryRun = true) {
  return runTdsOrchestrator({
    tdsCalculation: tdsService,
    tdsVendorLedger: tdsLedger,
    invoice, glCategory,
    tenantId: "tenant-1",
    clientOrgId: CLIENT_ORG_ID,
    vendorFingerprint: VENDOR,
    invoiceId: INVOICE_ID,
    dryRun
  });
}

describe("Compliance Retrigger via TDS orchestrator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmptyLedger();
  });

  describe("TDS calculation with new GL category", () => {
    it("returns low confidence when glCategory is null", async () => {
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR" };
      const result = await runOrchestrator(invoice, null);
      expect(result?.tds.section).toBeNull();
      expect(result?.tds.confidence).toBe("low");
    });

    it("returns section null when no mapping found for category", async () => {
      (TdsSectionMappingModel.find as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => ({ lean: () => Promise.resolve([]) }) })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR" };
      const result = await runOrchestrator(invoice, "Nonexistent Category");
      expect(result?.tds.section).toBeNull();
      expect(result?.tds.confidence).toBe("low");
    });

    it("falls back to TdsRateTable when tenant has no configured rates", async () => {
      mockSectionMapping("194J");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000, rateCompanyBps: 1000, rateNoPanBps: 2000,
          thresholdSingleMinor: 3000000, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR" };
      const result = await runOrchestrator(invoice, "Professional Services");
      expect(result?.tds.section).toBe("194J");
      expect(result?.tds.confidence).toBe("high");
      expect(result?.tds.rate).toBe(2000);
      expect(result?.tds.source).toBe("auto");
    });

    it("uses configured rate from tenant compliance config instead of TdsRateTable", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 800, rateCompany: 800, rateNoPan: 2000, threshold: 0, active: true }
      ]);
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR", pan: "ABCPK1234F" };
      const result = await runOrchestrator(invoice, "Professional Services");
      expect(result?.tds.section).toBe("194J");
      expect(result?.tds.rate).toBe(800);
      expect(result?.tds.amountMinor).toBe(800000);
      expect(result?.tds.netPayableMinor).toBe(9200000);
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("returns null rate and zero TDS when section is disabled in tenant config", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 0, active: false }
      ]);
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR", pan: "ABCPK1234F" };
      const result = await runOrchestrator(invoice, "Professional Services");
      expect(result?.tds.section).toBe("194J");
      expect(result?.tds.rate).toBeNull();
      expect(result?.tds.amountMinor).toBeNull();
      expect(result?.tds.netPayableMinor).toBeNull();
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("respects configured threshold from tenant config", async () => {
      mockSectionMapping("194C");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 5000000, active: true }
      ]);
      const invoice: ParsedInvoiceData = { totalAmountMinor: 3000000, currency: "INR", pan: "ABCPK1234F" };
      const result = await runOrchestrator(invoice, "Contractor Services");
      expect(result?.tds.amountMinor).toBe(0);
      expect(result?.tds.netPayableMinor).toBe(3000000);
      expect(result?.riskSignals.some(s => s.code === "TDS_BELOW_THRESHOLD")).toBe(true);
    });

    it("falls back to TdsRateTable when tenant config has no entry for the matched section", async () => {
      mockSectionMapping("194J");
      mockTenantConfigWithRates([
        { section: "194C", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 0, active: true }
      ]);
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000, rateCompanyBps: 1000, rateNoPanBps: 2000,
          thresholdSingleMinor: 0, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 10000000, currency: "INR", pan: "ABCPK1234F" };
      const result = await runOrchestrator(invoice, "Professional Services");
      expect(result?.tds.section).toBe("194J");
      expect(result?.tds.rate).toBe(1000);
      expect(TdsRateTableModel.findOne).toHaveBeenCalled();
    });

    it("emits TDS_SECTION_AMBIGUOUS when two mappings share the same priority", async () => {
      (TdsSectionMappingModel.find as jest.Mock).mockReturnValue({
        sort: () => ({ limit: () => ({ lean: () => Promise.resolve([
          { tdsSection: "194C", priority: 10 },
          { tdsSection: "194J", priority: 10 }
        ]) }) })
      });
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194C",
          rateIndividualBps: 100, rateCompanyBps: 200, rateNoPanBps: 2000,
          thresholdSingleMinor: 0, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 5_00_000, currency: "INR", pan: "AABCC1234F" };
      const result = await runOrchestrator(invoice, "Ambiguous Category");
      expect(result?.tds.confidence).toBe("medium");
      expect(result?.riskSignals.some(s => s.code === "TDS_SECTION_AMBIGUOUS")).toBe(true);
    });

    it("uses company PAN rate when PAN is a Company PAN", async () => {
      mockSectionMapping("194C");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194C",
          rateIndividualBps: 100, rateCompanyBps: 200, rateNoPanBps: 2000,
          thresholdSingleMinor: 0, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 5_00_000, currency: "INR", pan: "AABCC1234F" };
      const result = await runOrchestrator(invoice, "Contractor Services");
      expect(result?.tds.rateBps).toBe(200);
    });

    it("returns null tds rate when TdsRateTable has no matching active row", async () => {
      mockSectionMapping("194C");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve(null)
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 5_00_000, currency: "INR", pan: "ABCPK1234F" };
      const result = await runOrchestrator(invoice, "Contractor Services");
      expect(result?.tds.rateBps).toBeNull();
    });

    it("generates no-PAN risk signal when PAN is missing and section found", async () => {
      mockSectionMapping("194C");
      mockNoTenantConfig();
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194C",
          rateIndividualBps: 200, rateCompanyBps: 200, rateNoPanBps: 2000,
          thresholdSingleMinor: 0, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const invoice: ParsedInvoiceData = { totalAmountMinor: 5000000, currency: "INR" };
      const result = await runOrchestrator(invoice, "Contractor Services");
      expect(result?.tds.section).toBe("194C");
      expect(result?.riskSignals.some(s => s.code === "TDS_NO_PAN_PENALTY_RATE")).toBe(true);
    });
  });

  describe("lookupRate", () => {
    it("returns tenant config rate when tenant has matching active section", async () => {
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 750, rateCompany: 750, rateNoPan: 2000, threshold: 0, active: true }
      ]);
      const result = await tdsService.lookupRate("194J", "P", "tenant-1", CLIENT_ORG_ID);
      expect(result).not.toBeNull();
      expect(result!.rateBps).toBe(750);
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("returns null when section is marked inactive in tenant config", async () => {
      mockTenantConfigWithRates([
        { section: "194J", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 0, active: false }
      ]);
      const result = await tdsService.lookupRate("194J", "P", "tenant-1", CLIENT_ORG_ID);
      expect(result).toBeNull();
      expect(TdsRateTableModel.findOne).not.toHaveBeenCalled();
    });

    it("falls back to TdsRateTable when tenantId is omitted", async () => {
      (TdsRateTableModel.findOne as jest.Mock).mockReturnValue({
        lean: () => Promise.resolve({
          section: "194J",
          rateIndividualBps: 1000, rateCompanyBps: 1000, rateNoPanBps: 2000,
          thresholdSingleMinor: 0, thresholdAnnualMinor: 0, isActive: true
        })
      });
      const result = await tdsService.lookupRate("194J", "P");
      expect(result).not.toBeNull();
      expect(result!.rateBps).toBe(1000);
      expect(resolveTdsRatesConfig).not.toHaveBeenCalled();
    });
  });
});
