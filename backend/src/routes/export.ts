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

  router.post("/exports/tally/download", async (req, res, next) => {
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

      const result = await exportService.generateExportFile({
        ids,
        requestedBy,
        tenantId: authContext.tenantId
      });

      if (result.includedCount === 0) {
        res.status(404).json({ message: "No approved invoices found for export." });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/exports/tally/download/:batchId", async (req, res, next) => {
    try {
      const authContext = req.authContext;
      if (!authContext) {
        res.status(401).json({ message: "Authentication required." });
        return;
      }
      if (!exportService) {
        res.status(400).json({ message: "Tally exporter is not configured." });
        return;
      }

      const file = await exportService.downloadExportFile(req.params.batchId);
      if (!file) {
        res.status(404).json({ message: "Export file not found." });
        return;
      }

      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
      res.send(file.body);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}
