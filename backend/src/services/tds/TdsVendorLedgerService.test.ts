import { describeHarness } from "@/test-utils";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger.js";
import { TdsVendorLedgerService } from "@/services/tds/TdsVendorLedgerService.js";
import { FeatureFlagEvaluator, type FeatureFlagOverrideStore } from "@/services/flags/featureFlagEvaluator.js";
import {
  FEATURE_FLAG_REGISTRY,
  TDS_CUMULATIVE_ENABLED_FLAG
} from "@/services/flags/featureFlagRegistry.js";

const TENANT = "tenant-tds-1";
const VENDOR = "vendor-fingerprint-acme";
const FY = "2026-27";
const SECTION = "194C";
const APRIL_15_IST = new Date("2026-04-15T05:30:00+05:30");

function makeNoopStore(): FeatureFlagOverrideStore {
  return {
    async findOverride() {
      return null;
    },
    async findOverrides() {
      return {};
    }
  };
}

describeHarness("TdsVendorLedgerService", ({ getHarness }) => {
  let service: TdsVendorLedgerService;

  beforeAll(async () => {
    await TdsVendorLedgerModel.syncIndexes();
    service = new TdsVendorLedgerService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  describe("getCumulativeForVendor", () => {
    it("returns zero view when no document exists", async () => {
      const view = await service.getCumulativeForVendor(TENANT, VENDOR, FY, SECTION);
      expect(view).toEqual({
        cumulativeBaseMinor: 0,
        cumulativeTdsMinor: 0,
        invoiceCount: 0,
        thresholdCrossedAt: null,
        quarter: null
      });
    });

    it("returns null quarter when persisted doc has no quarter set", async () => {
      await TdsVendorLedgerModel.collection.insertOne({
        tenantId: TENANT,
        vendorFingerprint: VENDOR,
        financialYear: FY,
        section: SECTION,
        cumulativeBaseMinor: 100,
        cumulativeTdsMinor: 1,
        invoiceCount: 1,
        entries: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const view = await service.getCumulativeForVendor(TENANT, VENDOR, FY, SECTION);
      expect(view.quarter).toBeNull();
      expect(view.thresholdCrossedAt).toBeNull();
      expect(view.cumulativeBaseMinor).toBe(100);
    });

    it("returns persisted cumulative values after a record", async () => {
      await service.recordTdsToLedger({
        tenantId: TENANT,
        vendorFingerprint: VENDOR,
        financialYear: FY,
        section: SECTION,
        invoiceId: "inv-1",
        invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 5000_00,
        tdsAmountMinor: 50_00,
        rateSource: "rateTable",
        thresholdCrossed: false
      });

      const view = await service.getCumulativeForVendor(TENANT, VENDOR, FY, SECTION);
      expect(view.cumulativeBaseMinor).toBe(5000_00);
      expect(view.cumulativeTdsMinor).toBe(50_00);
      expect(view.invoiceCount).toBe(1);
      expect(view.quarter).toBe("Q1");
      expect(view.thresholdCrossedAt).toBeNull();
    });
  });

  describe("recordTdsToLedger", () => {
    it("creates the document on first call (upsert)", async () => {
      const view = await service.recordTdsToLedger({
        tenantId: TENANT,
        vendorFingerprint: VENDOR,
        financialYear: FY,
        section: SECTION,
        invoiceId: "inv-init",
        invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00,
        tdsAmountMinor: 10_00,
        rateSource: "rateTable",
        thresholdCrossed: false
      });
      expect(view.cumulativeBaseMinor).toBe(1000_00);
      expect(view.invoiceCount).toBe(1);

      const doc = await TdsVendorLedgerModel.findOne({
        tenantId: TENANT,
        vendorFingerprint: VENDOR,
        financialYear: FY,
        section: SECTION
      }).lean();
      expect(doc?.entries).toHaveLength(1);
      expect(doc?.entries?.[0]?.invoiceId).toBe("inv-init");
    });

    it("accumulates via $inc and appends entries via $push on subsequent calls", async () => {
      await service.recordTdsToLedger({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
        invoiceId: "inv-a", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
        rateSource: "rateTable", thresholdCrossed: false
      });
      await service.recordTdsToLedger({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
        invoiceId: "inv-b", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 2500_00, tdsAmountMinor: 25_00,
        rateSource: "rateTable", thresholdCrossed: false
      });

      const view = await service.getCumulativeForVendor(TENANT, VENDOR, FY, SECTION);
      expect(view.cumulativeBaseMinor).toBe(3500_00);
      expect(view.cumulativeTdsMinor).toBe(35_00);
      expect(view.invoiceCount).toBe(2);
    });

    it("stamps thresholdCrossedAt when threshold crosses on this record", async () => {
      const recordedAt = new Date("2026-04-15T10:00:00+05:30");
      const view = await service.recordTdsToLedger({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
        invoiceId: "inv-cross", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 100000_00, tdsAmountMinor: 1000_00,
        rateSource: "rateTable", thresholdCrossed: true,
        recordedAt
      });
      expect(view.thresholdCrossedAt?.toISOString()).toBe(recordedAt.toISOString());
    });

    it("keeps separate ledgers per section for the same vendor", async () => {
      await service.recordTdsToLedger({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: "194C",
        invoiceId: "inv-194c", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
        rateSource: "rateTable", thresholdCrossed: false
      });
      await service.recordTdsToLedger({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: "194J",
        invoiceId: "inv-194j", invoiceDate: APRIL_15_IST,
        taxableAmountMinor: 2000_00, tdsAmountMinor: 20_00,
        rateSource: "rateTable", thresholdCrossed: false
      });

      const c = await service.getCumulativeForVendor(TENANT, VENDOR, FY, "194C");
      const j = await service.getCumulativeForVendor(TENANT, VENDOR, FY, "194J");
      expect(c.cumulativeBaseMinor).toBe(1000_00);
      expect(j.cumulativeBaseMinor).toBe(2000_00);
    });

    it("rejects non-integer minor values (C-001)", async () => {
      await expect(
        service.recordTdsToLedger({
          tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
          invoiceId: "inv-bad", invoiceDate: APRIL_15_IST,
          taxableAmountMinor: 100.5, tdsAmountMinor: 10,
          rateSource: "rateTable", thresholdCrossed: false
        })
      ).rejects.toThrow(/integer/);
      await expect(
        service.recordTdsToLedger({
          tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
          invoiceId: "inv-bad", invoiceDate: APRIL_15_IST,
          taxableAmountMinor: 100, tdsAmountMinor: 10.25,
          rateSource: "rateTable", thresholdCrossed: false
        })
      ).rejects.toThrow(/integer/);
    });

    it("RFC §7.1 case 12 — concurrent writes produce final cumulative = sum of inputs", async () => {
      const N = 50;
      const baseAmount = 100_00;
      const tdsAmount = 1_00;

      const results = await Promise.all(
        Array.from({ length: N }, (_, i) =>
          service.recordTdsToLedger({
            tenantId: TENANT,
            vendorFingerprint: VENDOR,
            financialYear: FY,
            section: SECTION,
            invoiceId: `chaos-${i}`,
            invoiceDate: APRIL_15_IST,
            taxableAmountMinor: baseAmount,
            tdsAmountMinor: tdsAmount,
            rateSource: "rateTable",
            thresholdCrossed: false
          })
        )
      );

      expect(results).toHaveLength(N);

      const finalView = await service.getCumulativeForVendor(TENANT, VENDOR, FY, SECTION);
      expect(finalView.cumulativeBaseMinor).toBe(baseAmount * N);
      expect(finalView.cumulativeTdsMinor).toBe(tdsAmount * N);
      expect(finalView.invoiceCount).toBe(N);

      const doc = await TdsVendorLedgerModel.findOne({
        tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION
      }).lean();
      expect(doc?.entries).toHaveLength(N);
      const ids = (doc?.entries ?? []).map((e) => e.invoiceId).sort();
      const expected = Array.from({ length: N }, (_, i) => `chaos-${i}`).sort();
      expect(ids).toEqual(expected);
    });
  });

  describe("TDS_CUMULATIVE_ENABLED feature flag", () => {
    it("is registered, defaults off, and gates recordTdsToLedger callers", async () => {
      const evaluator = new FeatureFlagEvaluator({
        registry: FEATURE_FLAG_REGISTRY,
        overrideStore: makeNoopStore()
      });
      const enabled = await evaluator.isEnabled(TDS_CUMULATIVE_ENABLED_FLAG, { tenantId: TENANT });
      expect(enabled).toBe(false);

      const guardedRecord = async () => {
        if (!(await evaluator.isEnabled(TDS_CUMULATIVE_ENABLED_FLAG, { tenantId: TENANT }))) {
          return null;
        }
        return service.recordTdsToLedger({
          tenantId: TENANT, vendorFingerprint: VENDOR, financialYear: FY, section: SECTION,
          invoiceId: "inv-flagged", invoiceDate: APRIL_15_IST,
          taxableAmountMinor: 1000_00, tdsAmountMinor: 10_00,
          rateSource: "rateTable", thresholdCrossed: false
        });
      };

      const result = await guardedRecord();
      expect(result).toBeNull();
      const docs = await TdsVendorLedgerModel.countDocuments({});
      expect(docs).toBe(0);
    });
  });
});
