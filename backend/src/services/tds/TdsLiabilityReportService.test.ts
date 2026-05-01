import { describeHarness } from "@/test-utils";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { TdsVendorLedgerService } from "@/services/tds/TdsVendorLedgerService.js";
import { TdsLiabilityReportService } from "@/services/tds/TdsLiabilityReportService.js";

const TENANT_A = "tenant-tds-a";
const TENANT_B = "tenant-tds-b";
const VENDOR_ACME = "vendor-acme";
const VENDOR_BETA = "vendor-beta";
const FY = "2026-27";
const FY_OTHER = "2025-26";

const APRIL_15_IST = new Date("2026-04-15T05:30:00+05:30");
const JULY_10_IST = new Date("2026-07-10T05:30:00+05:30");
const OCT_05_IST = new Date("2026-10-05T05:30:00+05:30");
const FEB_20_IST = new Date("2027-02-20T05:30:00+05:30");

describeHarness("TdsLiabilityReportService", ({ getHarness }) => {
  let ledgerService: TdsVendorLedgerService;
  let reportService: TdsLiabilityReportService;

  beforeAll(async () => {
    await TdsVendorLedgerModel.syncIndexes();
    ledgerService = new TdsVendorLedgerService();
    reportService = new TdsLiabilityReportService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  async function seedTenantA(): Promise<string> {
    const tenant = await TenantModel.create({ name: "Tenant A" });
    const tenantId = tenant._id.toString();

    await ledgerService.recordTdsToLedger({
      tenantId, vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194C",
      invoiceId: "inv-a-q1", invoiceDate: APRIL_15_IST,
      taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
      rateSource: "rateTable", thresholdCrossed: false
    });
    await ledgerService.recordTdsToLedger({
      tenantId, vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194C",
      invoiceId: "inv-a-q2", invoiceDate: JULY_10_IST,
      taxableAmountMinor: 2000_00, tdsAmountMinor: 20_00,
      rateSource: "rateTable", thresholdCrossed: true
    });
    await ledgerService.recordTdsToLedger({
      tenantId, vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194J",
      invoiceId: "inv-a-q3", invoiceDate: OCT_05_IST,
      taxableAmountMinor: 5000_00, tdsAmountMinor: 500_00,
      rateSource: "rateTable", thresholdCrossed: false
    });
    await ledgerService.recordTdsToLedger({
      tenantId, vendorFingerprint: VENDOR_BETA, financialYear: FY, section: "194C",
      invoiceId: "inv-b-q4", invoiceDate: FEB_20_IST,
      taxableAmountMinor: 3000_00, tdsAmountMinor: 30_00,
      rateSource: "rateTable", thresholdCrossed: false
    });
    return tenantId;
  }

  describe("getReport — base behavior", () => {
    it("returns empty buckets and tan: null when no ledger data exists for the FY", async () => {
      const tenant = await TenantModel.create({ name: "Empty Tenant" });
      const report = await reportService.getReport({
        tenantId: tenant._id.toString(),
        financialYear: FY
      });
      expect(report).toEqual({
        tan: null,
        fy: FY,
        bySection: [],
        byVendor: [],
        byQuarter: []
      });
    });

    it("aggregates per-section, per-vendor and per-quarter buckets from the ledger", async () => {
      const tenantId = await seedTenantA();

      const report = await reportService.getReport({ tenantId, financialYear: FY });

      expect(report.fy).toBe(FY);
      expect(report.bySection).toEqual([
        expect.objectContaining({
          section: "194C",
          cumulativeBaseMinor: 6000_00,
          cumulativeTdsMinor: 60_00,
          invoiceCount: 3
        }),
        expect.objectContaining({
          section: "194J",
          cumulativeBaseMinor: 5000_00,
          cumulativeTdsMinor: 500_00,
          invoiceCount: 1,
          thresholdCrossedAt: null
        })
      ]);

      expect(report.bySection[0].thresholdCrossedAt).toBeInstanceOf(Date);

      expect(report.byVendor).toEqual([
        expect.objectContaining({
          vendorFingerprint: VENDOR_ACME,
          section: "194C",
          cumulativeBaseMinor: 3000_00,
          invoiceCount: 2
        }),
        expect.objectContaining({
          vendorFingerprint: VENDOR_ACME,
          section: "194J",
          cumulativeBaseMinor: 5000_00,
          invoiceCount: 1
        }),
        expect.objectContaining({
          vendorFingerprint: VENDOR_BETA,
          section: "194C",
          cumulativeBaseMinor: 3000_00,
          invoiceCount: 1
        })
      ]);

      expect(report.byQuarter).toEqual([
        expect.objectContaining({ quarter: "Q1", section: "194C", invoiceCount: 1, cumulativeBaseMinor: 1000_00 }),
        expect.objectContaining({ quarter: "Q2", section: "194C", invoiceCount: 1, cumulativeBaseMinor: 2000_00 }),
        expect.objectContaining({ quarter: "Q3", section: "194J", invoiceCount: 1, cumulativeBaseMinor: 5000_00 }),
        expect.objectContaining({ quarter: "Q4", section: "194C", invoiceCount: 1, cumulativeBaseMinor: 3000_00 })
      ]);
    });

    it("returns deterministic results across repeated calls (idempotent reads)", async () => {
      const tenantId = await seedTenantA();

      const first = await reportService.getReport({ tenantId, financialYear: FY });
      const second = await reportService.getReport({ tenantId, financialYear: FY });
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
  });

  describe("getReport — tenant isolation", () => {
    it("does not return ledger entries belonging to a different tenant", async () => {
      const tenantA = await TenantModel.create({ name: "Tenant A" });
      const tenantB = await TenantModel.create({ name: "Tenant B" });

      await ledgerService.recordTdsToLedger({
        tenantId: tenantA._id.toString(),
        vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194C",
        invoiceId: "inv-a", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
        rateSource: "rateTable", thresholdCrossed: false
      });
      await ledgerService.recordTdsToLedger({
        tenantId: tenantB._id.toString(),
        vendorFingerprint: VENDOR_BETA, financialYear: FY, section: "194J",
        invoiceId: "inv-b", invoiceDate: JULY_10_IST,
        taxableAmountMinor: 9999_00, tdsAmountMinor: 999_00,
        rateSource: "rateTable", thresholdCrossed: false
      });

      const reportA = await reportService.getReport({
        tenantId: tenantA._id.toString(),
        financialYear: FY
      });
      expect(reportA.bySection).toHaveLength(1);
      expect(reportA.bySection[0].section).toBe("194C");
      expect(reportA.byVendor).toEqual([
        expect.objectContaining({ vendorFingerprint: VENDOR_ACME })
      ]);
      const allText = JSON.stringify(reportA);
      expect(allText).not.toContain(VENDOR_BETA);
      expect(allText).not.toContain("194J");
    });

    it("does not leak ledger entries from a different financial year", async () => {
      const tenant = await TenantModel.create({ name: "Tenant A" });
      const tenantId = tenant._id.toString();

      await ledgerService.recordTdsToLedger({
        tenantId, vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194C",
        invoiceId: "inv-cur", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
        rateSource: "rateTable", thresholdCrossed: false
      });
      await ledgerService.recordTdsToLedger({
        tenantId, vendorFingerprint: VENDOR_ACME, financialYear: FY_OTHER, section: "194C",
        invoiceId: "inv-prev", invoiceDate: new Date("2025-06-15T05:30:00+05:30"),
        taxableAmountMinor: 9999_00, tdsAmountMinor: 999_00,
        rateSource: "rateTable", thresholdCrossed: false
      });

      const report = await reportService.getReport({ tenantId, financialYear: FY });
      expect(report.bySection).toHaveLength(1);
      expect(report.bySection[0].cumulativeBaseMinor).toBe(1000_00);
    });
  });

  describe("getReport — optional filters", () => {
    it.each([
      {
        label: "section",
        filter: { section: "194J" },
        expectedSection: { section: "194J", cumulativeBaseMinor: 5000_00 },
        expectedVendor: { vendorFingerprint: VENDOR_ACME, section: "194J", cumulativeBaseMinor: 5000_00 }
      },
      {
        label: "vendorFingerprint",
        filter: { vendorFingerprint: VENDOR_BETA },
        expectedSection: { section: "194C", cumulativeBaseMinor: 3000_00, invoiceCount: 1 },
        expectedVendor: { vendorFingerprint: VENDOR_BETA, section: "194C" }
      }
    ])("filters all buckets by $label (doc-level path)", async ({ filter, expectedSection, expectedVendor }) => {
      const tenantId = await seedTenantA();
      const report = await reportService.getReport({ tenantId, financialYear: FY, ...filter });
      expect(report.bySection).toEqual([expect.objectContaining(expectedSection)]);
      expect(report.byVendor).toEqual([expect.objectContaining(expectedVendor)]);
    });

    it("filters by quarter using entry-level aggregation", async () => {
      const tenantId = await seedTenantA();
      const report = await reportService.getReport({
        tenantId,
        financialYear: FY,
        quarter: "Q2"
      });
      expect(report.byQuarter).toEqual([
        expect.objectContaining({ quarter: "Q2", section: "194C", invoiceCount: 1, cumulativeBaseMinor: 2000_00 })
      ]);
      expect(report.bySection).toEqual([
        expect.objectContaining({ section: "194C", cumulativeBaseMinor: 2000_00, invoiceCount: 1 })
      ]);
      expect(report.byVendor).toEqual([
        expect.objectContaining({ vendorFingerprint: VENDOR_ACME, section: "194C", cumulativeBaseMinor: 2000_00 })
      ]);
    });
  });

  describe("getReport — TAN propagation (C-007)", () => {
    it("returns tan: null when the Tenant document has no tan field", async () => {
      const tenantId = await seedTenantA();
      const report = await reportService.getReport({ tenantId, financialYear: FY });
      expect(report.tan).toBeNull();
    });

    it("returns the persisted tan string when present on the Tenant document", async () => {
      const tenant = await TenantModel.create({ name: "Tenant T" });
      await TenantModel.collection.updateOne(
        { _id: tenant._id },
        { $set: { tan: "BLRA12345B" } }
      );
      await ledgerService.recordTdsToLedger({
        tenantId: tenant._id.toString(),
        vendorFingerprint: VENDOR_ACME, financialYear: FY, section: "194C",
        invoiceId: "inv-tan", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
        rateSource: "rateTable", thresholdCrossed: false
      });

      const report = await reportService.getReport({
        tenantId: tenant._id.toString(),
        financialYear: FY
      });
      expect(report.tan).toBe("BLRA12345B");
    });
  });

  describe("getReport — index coverage (NFR-001)", () => {
    it("uses the existing tenantId+financialYear+section compound index for the primary $match", async () => {
      const tenantId = await seedTenantA();
      const explain = await TdsVendorLedgerModel.collection
        .find({ tenantId, financialYear: FY })
        .explain("queryPlanner");
      const winningPlan = JSON.stringify(explain);
      expect(winningPlan).toContain("IXSCAN");
      expect(winningPlan).not.toContain("COLLSCAN");
    });
  });
});
