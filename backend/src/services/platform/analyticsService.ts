import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

interface DailyStat {
  date: string;
  count: number;
  amountMinor?: number;
}

interface VendorStat {
  vendor: string;
  count: number;
  amountMinor: number;
}

interface StatusStat {
  status: string;
  count: number;
}

interface AnalyticsOverview {
  kpis: {
    totalInvoices: number;
    approvedCount: number;
    approvedAmountMinor: number;
    pendingAmountMinor: number;
    exportedCount: number;
    needsReviewCount: number;
  };
  dailyApprovals: DailyStat[];
  dailyIngestion: DailyStat[];
  dailyExports: DailyStat[];
  statusBreakdown: StatusStat[];
  topVendorsByApproved: VendorStat[];
  topVendorsByPending: VendorStat[];
}

const AGG_OPTIONS = { allowDiskUse: true };

export async function getOverview(tenantId: string, from: Date, to: Date, approverId?: string): Promise<AnalyticsOverview> {
  const approverFilter = approverId ? { "approval.userId": approverId } : {};

  const [kpiResult, dailyApprovalsResult, dailyIngestionResult, dailyExportsResult, statusResult, vendorsApprovedResult, vendorsPendingResult] =
    await Promise.all([
      InvoiceModel.aggregate(
        [
          { $match: { tenantId, createdAt: { $gte: from, $lte: to } } },
          { $project: { status: 1, "parsed.totalAmountMinor": 1, "approval.approvedBy": 1, "approval.userId": 1, "export.exportedAt": 1 } },
          {
            $facet: {
              total: [{ $count: "n" }],
              approved: [{ $match: { status: { $in: [INVOICE_STATUS.APPROVED, INVOICE_STATUS.EXPORTED] }, ...approverFilter } }, { $count: "n" }],
              approvedAmount: [
                { $match: { status: { $in: [INVOICE_STATUS.APPROVED, INVOICE_STATUS.EXPORTED] }, ...approverFilter } },
                { $group: { _id: null, total: { $sum: "$parsed.totalAmountMinor" } } }
              ],
              pendingAmount: [
                { $match: { status: { $in: [INVOICE_STATUS.PARSED, INVOICE_STATUS.NEEDS_REVIEW] } } },
                { $group: { _id: null, total: { $sum: "$parsed.totalAmountMinor" } } }
              ],
              exported: [{ $match: { status: INVOICE_STATUS.EXPORTED, ...approverFilter } }, { $count: "n" }],
              needsReview: [{ $match: { status: INVOICE_STATUS.NEEDS_REVIEW } }, { $count: "n" }]
            }
          }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, "approval.approvedAt": { $gte: from, $lte: to }, ...approverFilter } },
          { $project: { "approval.approvedAt": 1, "parsed.totalAmountMinor": 1 } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$approval.approvedAt" } },
              count: { $sum: 1 },
              amountMinor: { $sum: "$parsed.totalAmountMinor" }
            }
          },
          { $sort: { _id: 1 } }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, createdAt: { $gte: from, $lte: to } } },
          { $project: { createdAt: 1 } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, "export.exportedAt": { $gte: from, $lte: to } } },
          { $project: { "export.exportedAt": 1 } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$export.exportedAt" } },
              count: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, createdAt: { $gte: from, $lte: to } } },
          { $project: { status: 1 } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, status: { $in: [INVOICE_STATUS.APPROVED, INVOICE_STATUS.EXPORTED] }, "approval.approvedAt": { $gte: from, $lte: to }, ...approverFilter } },
          { $project: { "parsed.vendorName": 1, "parsed.totalAmountMinor": 1 } },
          {
            $group: {
              _id: { $ifNull: ["$parsed.vendorName", "(Unknown)"] },
              count: { $sum: 1 },
              amountMinor: { $sum: "$parsed.totalAmountMinor" }
            }
          },
          { $sort: { amountMinor: -1 } },
          { $limit: 10 }
        ],
        AGG_OPTIONS
      ),

      InvoiceModel.aggregate(
        [
          { $match: { tenantId, status: { $in: [INVOICE_STATUS.PARSED, INVOICE_STATUS.NEEDS_REVIEW] }, createdAt: { $gte: from, $lte: to } } },
          { $project: { "parsed.vendorName": 1, "parsed.totalAmountMinor": 1 } },
          {
            $group: {
              _id: { $ifNull: ["$parsed.vendorName", "(Unknown)"] },
              count: { $sum: 1 },
              amountMinor: { $sum: "$parsed.totalAmountMinor" }
            }
          },
          { $sort: { amountMinor: -1 } },
          { $limit: 10 }
        ],
        AGG_OPTIONS
      )
    ]);

  const kpi = kpiResult[0] ?? {};

  return {
    kpis: {
      totalInvoices: kpi.total?.[0]?.n ?? 0,
      approvedCount: kpi.approved?.[0]?.n ?? 0,
      approvedAmountMinor: kpi.approvedAmount?.[0]?.total ?? 0,
      pendingAmountMinor: kpi.pendingAmount?.[0]?.total ?? 0,
      exportedCount: kpi.exported?.[0]?.n ?? 0,
      needsReviewCount: kpi.needsReview?.[0]?.n ?? 0
    },
    dailyApprovals: dailyApprovalsResult.map((d) => ({ date: d._id as string, count: d.count as number, amountMinor: d.amountMinor as number })),
    dailyIngestion: dailyIngestionResult.map((d) => ({ date: d._id as string, count: d.count as number })),
    dailyExports: dailyExportsResult.map((d) => ({ date: d._id as string, count: d.count as number })),
    statusBreakdown: statusResult.map((d) => ({ status: d._id as string, count: d.count as number })),
    topVendorsByApproved: vendorsApprovedResult.map((d) => ({ vendor: d._id as string, count: d.count as number, amountMinor: d.amountMinor as number })),
    topVendorsByPending: vendorsPendingResult.map((d) => ({ vendor: d._id as string, count: d.count as number, amountMinor: d.amountMinor as number }))
  };
}
