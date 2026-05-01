import { Router } from "express";
import { requireAuth } from "@/auth/requireAuth.js";
import { getAuth } from "@/types/auth.js";
import { REPORTS_URL_PATHS } from "@/routes/urls/reportsUrls.js";
import { TdsLiabilityReportService, isTdsQuarter } from "@/services/tds/TdsLiabilityReportService.js";
import type { TdsQuarter } from "@/services/tds/fiscalYearUtils.js";

const FY_FORMAT = /^\d{4}-\d{2}$/;

export function createTdsLiabilityReportRouter() {
  const router = Router();
  router.use(requireAuth);

  const service = new TdsLiabilityReportService();

  router.get(REPORTS_URL_PATHS.tdsLiability, async (req, res, next) => {
    try {
      const auth = getAuth(req);

      const fy = typeof req.query.fy === "string" ? req.query.fy.trim() : "";
      if (!fy || !FY_FORMAT.test(fy)) {
        res.status(400).json({
          error: "invalid_fy",
          message: "Query parameter 'fy' is required and must match the YYYY-YY format (e.g. 2025-26)."
        });
        return;
      }

      const vendorFingerprintParam = typeof req.query.vendorFingerprint === "string"
        ? req.query.vendorFingerprint.trim()
        : "";
      const sectionParam = typeof req.query.section === "string" ? req.query.section.trim() : "";
      const quarterParam = typeof req.query.quarter === "string" ? req.query.quarter.trim() : "";

      if (quarterParam && !isTdsQuarter(quarterParam)) {
        res.status(400).json({
          error: "invalid_quarter",
          message: "Query parameter 'quarter' must be one of Q1, Q2, Q3, Q4."
        });
        return;
      }

      const quarter: TdsQuarter | undefined = quarterParam && isTdsQuarter(quarterParam)
        ? quarterParam
        : undefined;

      const report = await service.getReport({
        tenantId: auth.tenantId,
        financialYear: fy,
        ...(vendorFingerprintParam ? { vendorFingerprint: vendorFingerprintParam } : {}),
        ...(sectionParam ? { section: sectionParam } : {}),
        ...(quarter ? { quarter } : {})
      });

      res.json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
