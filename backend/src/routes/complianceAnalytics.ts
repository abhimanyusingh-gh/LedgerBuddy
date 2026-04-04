import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { InvoiceModel } from "../models/Invoice.js";
import { VendorMasterModel } from "../models/VendorMaster.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";

export function createComplianceAnalyticsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/analytics/compliance", requireCap("canDownloadComplianceReports"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;

      const dateFilter: Record<string, unknown> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;

      const baseQuery: Record<string, unknown> = { tenantId };
      if (from || to) baseQuery.createdAt = dateFilter;

      const [tdsAgg, glAgg, signalAgg, panCount, totalWithCompliance, vendorHealth] = await Promise.all([
        InvoiceModel.aggregate([
          { $match: { ...baseQuery, "compliance.tds.section": { $ne: null }, "compliance.tds.amountMinor": { $gt: 0 } } },
          { $group: { _id: "$compliance.tds.section", count: { $sum: 1 }, totalAmountMinor: { $sum: "$compliance.tds.amountMinor" } } },
          { $sort: { totalAmountMinor: -1 } }
        ]),

        InvoiceModel.aggregate([
          { $match: { ...baseQuery, "compliance.glCode.code": { $ne: null } } },
          { $group: { _id: "$compliance.glCode.code", name: { $first: "$compliance.glCode.name" }, count: { $sum: 1 }, totalAmountMinor: { $sum: "$parsed.totalAmountMinor" } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),

        InvoiceModel.aggregate([
          { $match: { ...baseQuery, "compliance.riskSignals": { $exists: true, $ne: [] } } },
          { $unwind: "$compliance.riskSignals" },
          { $group: { _id: "$compliance.riskSignals.code", count: { $sum: 1 }, actedOn: { $sum: { $cond: [{ $in: ["$compliance.riskSignals.status", ["acted-on", "dismissed"]] }, 1, 0] } } } },
          { $sort: { count: -1 } }
        ]),

        InvoiceModel.countDocuments({ ...baseQuery, "compliance.pan.validationResult": "valid" }),
        InvoiceModel.countDocuments({ ...baseQuery, "compliance": { $exists: true } }),

        Promise.all([
          VendorMasterModel.countDocuments({ tenantId, pan: null }),
          VendorMasterModel.countDocuments({ tenantId, "bankHistory.1": { $exists: true } }),
          VendorMasterModel.countDocuments({ tenantId, "msme.udyamNumber": { $ne: null } })
        ])
      ]);

      const tdsTotalMinor = tdsAgg.reduce((sum: number, s: { totalAmountMinor: number }) => sum + s.totalAmountMinor, 0);

      const tdsManualCount = await InvoiceModel.countDocuments({ ...baseQuery, "compliance.tds.source": "manual" });
      const tdsAutoCount = await InvoiceModel.countDocuments({ ...baseQuery, "compliance.tds.source": "auto", "compliance.tds.section": { $ne: null } });
      const overrideRate = tdsAutoCount + tdsManualCount > 0 ? Math.round((tdsManualCount / (tdsAutoCount + tdsManualCount)) * 100) : 0;

      res.json({
        tdsSummary: {
          totalAmountMinor: tdsTotalMinor,
          bySection: tdsAgg.map((s: { _id: string; count: number; totalAmountMinor: number }) => ({
            section: s._id,
            count: s.count,
            amountMinor: s.totalAmountMinor
          })),
          overrideRate
        },
        glDistribution: glAgg.map((g: { _id: string; name: string; count: number; totalAmountMinor: number }) => ({
          code: g._id,
          name: g.name ?? g._id,
          count: g.count,
          amountMinor: g.totalAmountMinor
        })),
        riskSignalFrequency: signalAgg.map((s: { _id: string; count: number; actedOn: number }) => ({
          code: s._id,
          count: s.count,
          actionRate: s.count > 0 ? Math.round((s.actedOn / s.count) * 100) : 0
        })),
        panCoverage: {
          total: totalWithCompliance,
          withValidPan: panCount,
          percentage: totalWithCompliance > 0 ? Math.round((panCount / totalWithCompliance) * 100) : 0
        },
        vendorHealth: {
          missingPan: vendorHealth[0],
          recentBankChanges: vendorHealth[1],
          msmeVendors: vendorHealth[2]
        }
      });
    } catch (error) { next(error); }
  });

  return router;
}
