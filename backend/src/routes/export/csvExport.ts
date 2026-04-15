import { getAuth } from "@/types/auth.js";
import { EXPORT_CONTENT_TYPE } from "@/types/mime.js";
import { Router } from "express";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { generateCsvExport } from "@/services/export/csvExporter.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";

export function createCsvExportRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/exports/csv", requireCap("canExportToCsv"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const ids = Array.isArray(req.body?.ids) ? req.body.ids : undefined;
      const columns = Array.isArray(req.body?.columns) ? req.body.columns : undefined;

      const query: Record<string, unknown> = { tenantId, status: "APPROVED" };
      if (ids && ids.length > 0) query._id = { $in: ids };

      const invoices = await InvoiceModel.find(query).lean();
      if (invoices.length === 0) {
        res.status(404).json({ message: "No approved invoices found for export." });
        return;
      }

      const result = generateCsvExport(invoices as unknown as import("../../models/invoice/Invoice.js").InvoiceDocument[], columns);

      res.setHeader("Content-Type", EXPORT_CONTENT_TYPE.CSV);
      res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
      res.send(result.content);
    } catch (error) { next(error); }
  });

  return router;
}
