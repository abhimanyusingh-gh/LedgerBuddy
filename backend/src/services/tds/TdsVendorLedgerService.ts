import { TdsVendorLedgerModel, type TdsVendorLedger } from "@/models/compliance/TdsVendorLedger.js";
import { determineQuarter, type TdsQuarter } from "@/services/tds/fiscalYearUtils.js";
import type { TdsRateSource } from "@/types/invoice.js";

interface TdsCumulativeView {
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
  thresholdCrossedAt: Date | null;
  quarter: TdsQuarter | null;
  entries: Array<{ rateBps: number }>;
}

const ZERO_VIEW: TdsCumulativeView = {
  cumulativeBaseMinor: 0,
  cumulativeTdsMinor: 0,
  invoiceCount: 0,
  thresholdCrossedAt: null,
  quarter: null,
  entries: []
};

interface RecordTdsToLedgerInput {
  tenantId: string;
  vendorFingerprint: string;
  financialYear: string;
  section: string;
  invoiceId: string;
  invoiceDate: Date;
  taxableAmountMinor: number;
  tdsAmountMinor: number;
  rateBps?: number;
  rateSource: TdsRateSource | string;
  thresholdCrossed: boolean;
  recordedAt?: Date;
}

function assertInteger(field: string, value: number): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`TdsVendorLedgerService: ${field} must be an integer (got ${value})`);
  }
}

export class TdsVendorLedgerService {
  async getCumulativeForVendor(
    tenantId: string,
    vendorFingerprint: string,
    financialYear: string,
    section: string
  ): Promise<TdsCumulativeView> {
    const doc = await TdsVendorLedgerModel.findOne({
      tenantId,
      vendorFingerprint,
      financialYear,
      section
    })
      .lean<TdsVendorLedger | null>()
      .exec();
    if (!doc) return { ...ZERO_VIEW };
    return toView(doc);
  }

  async recordTdsToLedger(input: RecordTdsToLedgerInput): Promise<TdsCumulativeView> {
    assertInteger("taxableAmountMinor", input.taxableAmountMinor);
    assertInteger("tdsAmountMinor", input.tdsAmountMinor);
    const rateBps = input.rateBps ?? 0;
    assertInteger("rateBps", rateBps);

    const recordedAt = input.recordedAt ?? new Date();
    const quarter = determineQuarter(input.invoiceDate);

    const setOnInsert: Record<string, unknown> = {
      tenantId: input.tenantId,
      vendorFingerprint: input.vendorFingerprint,
      financialYear: input.financialYear,
      section: input.section
    };

    const set: Record<string, unknown> = {
      lastUpdatedInvoiceId: input.invoiceId,
      quarter
    };
    if (input.thresholdCrossed) {
      set.thresholdCrossedAt = recordedAt;
    }

    const updated = await TdsVendorLedgerModel.findOneAndUpdate(
      {
        tenantId: input.tenantId,
        vendorFingerprint: input.vendorFingerprint,
        financialYear: input.financialYear,
        section: input.section
      },
      {
        $setOnInsert: setOnInsert,
        $set: set,
        $inc: {
          cumulativeBaseMinor: input.taxableAmountMinor,
          cumulativeTdsMinor: input.tdsAmountMinor,
          invoiceCount: 1
        },
        $push: {
          entries: {
            invoiceId: input.invoiceId,
            invoiceDate: input.invoiceDate,
            taxableAmountMinor: input.taxableAmountMinor,
            tdsAmountMinor: input.tdsAmountMinor,
            rateBps,
            rateSource: input.rateSource,
            quarter,
            recordedAt
          }
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
      .lean<TdsVendorLedger>()
      .exec();

    return toView(updated);
  }
}

function toView(doc: TdsVendorLedger): TdsCumulativeView {
  const rawEntries = (doc.entries as Array<{ rateBps?: number }> | undefined) ?? [];
  return {
    cumulativeBaseMinor: doc.cumulativeBaseMinor as number,
    cumulativeTdsMinor: doc.cumulativeTdsMinor as number,
    invoiceCount: doc.invoiceCount as number,
    thresholdCrossedAt: doc.thresholdCrossedAt ?? null,
    quarter: (doc.quarter as TdsQuarter | null) ?? null,
    entries: rawEntries.map(e => ({ rateBps: e.rateBps ?? 0 }))
  };
}
