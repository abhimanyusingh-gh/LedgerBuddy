import type { PipelineStage } from "mongoose";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { TDS_QUARTER, type TdsQuarter } from "@/services/tds/fiscalYearUtils.js";

interface TdsLiabilityFilter {
  tenantId: string;
  financialYear: string;
  vendorFingerprint?: string;
  section?: string;
  quarter?: TdsQuarter;
}

interface SectionBucket {
  section: string;
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
  thresholdCrossedAt: Date | null;
}

interface VendorBucket {
  vendorFingerprint: string;
  section: string;
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
  thresholdCrossedAt: Date | null;
}

interface QuarterBucket {
  quarter: TdsQuarter;
  section: string;
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
}

interface TdsLiabilityReport {
  tan: string | null;
  fy: string;
  bySection: SectionBucket[];
  byVendor: VendorBucket[];
  byQuarter: QuarterBucket[];
}

const QUARTER_VALUES = Object.values(TDS_QUARTER) as TdsQuarter[];

export function isTdsQuarter(value: unknown): value is TdsQuarter {
  return typeof value === "string" && (QUARTER_VALUES as string[]).includes(value);
}

interface SectionBucketRaw {
  _id: string;
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
  thresholdCrossedAt: Date | null;
}

interface VendorBucketRaw {
  _id: { vendorFingerprint: string; section: string };
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
  thresholdCrossedAt: Date | null;
}

interface QuarterBucketRaw {
  _id: { quarter: TdsQuarter; section: string };
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  invoiceCount: number;
}

interface FacetResult {
  bySection: SectionBucketRaw[];
  byVendor: VendorBucketRaw[];
  byQuarter: QuarterBucketRaw[];
}

function quarterPrefix(quarter: TdsQuarter | undefined): PipelineStage.FacetPipelineStage[] {
  if (!quarter) return [];
  return [
    { $unwind: "$entries" },
    { $match: { "entries.quarter": quarter } }
  ];
}

function buildBySection(quarter: TdsQuarter | undefined): PipelineStage.FacetPipelineStage[] {
  const prefix = quarterPrefix(quarter);
  const baseField = quarter ? "$entries.taxableAmountMinor" : "$cumulativeBaseMinor";
  const tdsField = quarter ? "$entries.tdsAmountMinor" : "$cumulativeTdsMinor";
  const countField = quarter ? 1 : "$invoiceCount";
  return [
    ...prefix,
    {
      $group: {
        _id: "$section",
        cumulativeBaseMinor: { $sum: baseField },
        cumulativeTdsMinor: { $sum: tdsField },
        invoiceCount: { $sum: countField },
        thresholdCrossedAt: { $min: "$thresholdCrossedAt" }
      }
    },
    { $sort: { _id: 1 } }
  ];
}

function buildByVendor(quarter: TdsQuarter | undefined): PipelineStage.FacetPipelineStage[] {
  const prefix = quarterPrefix(quarter);
  const baseField = quarter ? "$entries.taxableAmountMinor" : "$cumulativeBaseMinor";
  const tdsField = quarter ? "$entries.tdsAmountMinor" : "$cumulativeTdsMinor";
  const countField = quarter ? 1 : "$invoiceCount";
  return [
    ...prefix,
    {
      $group: {
        _id: { vendorFingerprint: "$vendorFingerprint", section: "$section" },
        cumulativeBaseMinor: { $sum: baseField },
        cumulativeTdsMinor: { $sum: tdsField },
        invoiceCount: { $sum: countField },
        thresholdCrossedAt: { $min: "$thresholdCrossedAt" }
      }
    },
    { $sort: { "_id.vendorFingerprint": 1, "_id.section": 1 } }
  ];
}

function buildByQuarter(quarter: TdsQuarter | undefined): PipelineStage.FacetPipelineStage[] {
  const prefix: PipelineStage.FacetPipelineStage[] = quarter
    ? quarterPrefix(quarter)
    : [{ $unwind: "$entries" }];
  return [
    ...prefix,
    {
      $group: {
        _id: { quarter: "$entries.quarter", section: "$section" },
        cumulativeBaseMinor: { $sum: "$entries.taxableAmountMinor" },
        cumulativeTdsMinor: { $sum: "$entries.tdsAmountMinor" },
        invoiceCount: { $sum: 1 }
      }
    },
    { $sort: { "_id.quarter": 1, "_id.section": 1 } }
  ];
}

export class TdsLiabilityReportService {
  async getReport(filter: TdsLiabilityFilter): Promise<TdsLiabilityReport> {
    const match: Record<string, unknown> = {
      tenantId: filter.tenantId,
      financialYear: filter.financialYear
    };
    if (filter.vendorFingerprint) match.vendorFingerprint = filter.vendorFingerprint;
    if (filter.section) match.section = filter.section;

    const quarter = filter.quarter;
    const facetStage: Record<string, PipelineStage.FacetPipelineStage[]> = {
      bySection: buildBySection(quarter),
      byVendor: buildByVendor(quarter),
      byQuarter: buildByQuarter(quarter)
    };

    const [aggregate, tenant] = await Promise.all([
      TdsVendorLedgerModel.aggregate<FacetResult>([
        { $match: match },
        { $facet: facetStage }
      ]).exec(),
      TenantModel.findById(filter.tenantId).lean<Record<string, unknown> | null>().exec()
    ]);

    const facets = aggregate[0] ?? { bySection: [], byVendor: [], byQuarter: [] };

    return {
      tan: extractTan(tenant),
      fy: filter.financialYear,
      bySection: facets.bySection.map((bucket) => ({
        section: bucket._id,
        cumulativeBaseMinor: bucket.cumulativeBaseMinor,
        cumulativeTdsMinor: bucket.cumulativeTdsMinor,
        invoiceCount: bucket.invoiceCount,
        thresholdCrossedAt: bucket.thresholdCrossedAt ?? null
      })),
      byVendor: facets.byVendor.map((bucket) => ({
        vendorFingerprint: bucket._id.vendorFingerprint,
        section: bucket._id.section,
        cumulativeBaseMinor: bucket.cumulativeBaseMinor,
        cumulativeTdsMinor: bucket.cumulativeTdsMinor,
        invoiceCount: bucket.invoiceCount,
        thresholdCrossedAt: bucket.thresholdCrossedAt ?? null
      })),
      byQuarter: facets.byQuarter.map((bucket) => ({
        quarter: bucket._id.quarter,
        section: bucket._id.section,
        cumulativeBaseMinor: bucket.cumulativeBaseMinor,
        cumulativeTdsMinor: bucket.cumulativeTdsMinor,
        invoiceCount: bucket.invoiceCount
      }))
    };
  }
}

function extractTan(tenant: Record<string, unknown> | null): string | null {
  if (!tenant) return null;
  const raw = tenant.tan;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}
