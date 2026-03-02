import { Router } from "express";
import type { ExportService } from "../services/exportService.js";

export function createExportRouter(exportService: ExportService | null) {
  const router = Router();

  router.post("/exports/tally", async (req, res, next) => {
    try {
      const authContext = req.authContext;
      if (!authContext) {
        res.status(401).json({ message: "Authentication required." });
        return;
      }
      if (!exportService) {
        res.status(400).json({
          message: "Tally exporter is not configured. Provide TALLY_ENDPOINT and TALLY_COMPANY."
        });
        return;
      }

      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : undefined;
      const requestedBy = typeof req.body?.requestedBy === "string" ? req.body.requestedBy : "system";

      const result = await exportService.exportApprovedInvoices({
        ids,
        requestedBy,
        tenantId: authContext.tenantId
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
