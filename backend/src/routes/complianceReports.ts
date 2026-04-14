import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { InvoiceModel } from "../models/invoice/Invoice.js";
import { VendorMasterModel } from "../models/compliance/VendorMaster.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";

export function createComplianceReportsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/reports/tds-summary", requireCap("canDownloadComplianceReports"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const from = req.query.from ? new Date(String(req.query.from)) : undefined;
      const to = req.query.to ? new Date(String(req.query.to)) : undefined;

      const dateFilter: Record<string, unknown> = {};
      if (from) dateFilter.$gte = from;
      if (to) dateFilter.$lte = to;

      const query: Record<string, unknown> = {
        tenantId,
        "compliance.tds.section": { $ne: null },
        "compliance.tds.amountMinor": { $gt: 0 }
      };
      if (from || to) query.createdAt = dateFilter;

      const invoices = await InvoiceModel.find(query)
        .select({ "parsed.vendorName": 1, "parsed.invoiceNumber": 1, "parsed.invoiceDate": 1, "compliance.tds": 1 })
        .lean();

      const rows = invoices.map(inv => ({
        vendorName: inv.parsed?.vendorName ?? "",
        invoiceNumber: inv.parsed?.invoiceNumber ?? "",
        invoiceDate: inv.parsed?.invoiceDate ?? "",
        tdsSection: (inv as Record<string, unknown>).compliance ? ((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds ? (((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds as Record<string, unknown>).section : "" : "",
        tdsRate: (inv as Record<string, unknown>).compliance ? ((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds ? (((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds as Record<string, unknown>).rate : 0 : 0,
        tdsAmountMinor: (inv as Record<string, unknown>).compliance ? ((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds ? (((inv as Record<string, unknown>).compliance as Record<string, unknown>).tds as Record<string, unknown>).amountMinor : 0 : 0
      }));

      if (req.query.format === "csv") {
        const header = "Vendor,Invoice Number,Invoice Date,TDS Section,TDS Rate (bps),TDS Amount (minor)\n";
        const csvRows = rows.map(r => `"${r.vendorName}","${r.invoiceNumber}","${r.invoiceDate}","${r.tdsSection}",${r.tdsRate},${r.tdsAmountMinor}`).join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=tds-summary.csv");
        res.send(header + csvRows);
        return;
      }

      res.json({ items: rows, total: rows.length });
    } catch (error) { next(error); }
  });

  router.get("/reports/vendor-health", requireCap("canDownloadComplianceReports"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;

      const [missingPan, recentBankChanges, msmeVendors, totalVendors] = await Promise.all([
        VendorMasterModel.countDocuments({ tenantId, pan: null }),
        VendorMasterModel.countDocuments({ tenantId, "bankHistory.1": { $exists: true } }),
        VendorMasterModel.countDocuments({ tenantId, "msme.udyamNumber": { $ne: null } }),
        VendorMasterModel.countDocuments({ tenantId })
      ]);

      const result = { totalVendors, missingPan, recentBankChanges, msmeVendors };

      if (req.query.format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", "attachment; filename=vendor-health.csv");
        res.send(`Metric,Count\nTotal Vendors,${totalVendors}\nMissing PAN,${missingPan}\nBank Changes,${recentBankChanges}\nMSME Vendors,${msmeVendors}\n`);
        return;
      }

      res.json(result);
    } catch (error) { next(error); }
  });

  return router;
}
