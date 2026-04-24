import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import type { ExportService } from "@/services/export/exportService.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireActiveClientOrg } from "@/auth/activeClientOrg.js";
import { requireCap } from "@/auth/requireCapability.js";
import { isString } from "@/utils/validation.js";

export function createExportRouter(exportService: ExportService | null) {
  const router = Router();
  router.use(requireAuth);

  router.post("/exports/tally", requireCap("canExportToTally"), requireActiveClientOrg, async (req, res, next) => {
    try {
      if (!exportService) {
        res.status(400).json({
          message: "Tally exporter is not configured. Provide TALLY_ENDPOINT and TALLY_COMPANY."
        });
        return;
      }

      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : undefined;

      const result = await exportService.exportApprovedInvoices({
        ids,
        requestedBy: getAuth(req).email,
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.activeClientOrgId!
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.post("/exports/tally/download", requireCap("canExportToTally"), requireActiveClientOrg, async (req, res, next) => {
    try {
      if (!exportService) {
        res.status(400).json({
          message: "Tally exporter is not configured. Provide TALLY_ENDPOINT and TALLY_COMPANY."
        });
        return;
      }
      if (!exportService.canGenerateFiles) {
        res.status(503).json({ message: "Export file generation is not available. File store is not configured." });
        return;
      }

      const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(isString) : undefined;

      const result = await exportService.generateExportFile({
        ids,
        requestedBy: getAuth(req).email,
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.activeClientOrgId!
      });

      if (result.includedCount === 0) {
        const reason = result.skippedCount > 0
          ? `${result.skippedCount} invoice(s) skipped: ${result.skippedItems.map((s) => s.error ?? "unknown").join("; ").substring(0, 200)}`
          : "No approved invoices found for export.";
        res.status(404).json({ message: reason, skippedCount: result.skippedCount, alreadyExportedCount: (result as Record<string, unknown>).alreadyExportedCount ?? 0 });
        return;
      }

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/exports/tally/history", requireActiveClientOrg, async (req, res, next) => {
    try {
      if (!exportService) {
        res.status(400).json({ message: "Tally exporter is not configured." });
        return;
      }

      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);

      const result = await exportService.listExportHistory({
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.activeClientOrgId!,
        page,
        limit
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/exports/tally/download/:batchId", requireActiveClientOrg, async (req, res, next) => {
    try {
      if (!exportService) {
        res.status(400).json({ message: "Tally exporter is not configured." });
        return;
      }
      if (!exportService.canGenerateFiles) {
        res.status(503).json({ message: "Export file generation is not available. File store is not configured." });
        return;
      }

      const file = await exportService.downloadExportFile(req.params.batchId, getAuth(req).tenantId, req.activeClientOrgId!);
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
