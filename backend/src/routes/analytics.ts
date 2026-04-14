import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { requireAuth } from "../auth/requireAuth.js";
import { getOverview } from "../services/platform/analyticsService.js";

export function createAnalyticsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/analytics/overview", async (req, res, next) => {
    try {
      const authContext = getAuth(req);

      const now = new Date();
      const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);

      const fromParam = typeof req.query.from === "string" ? req.query.from : "";
      const toParam = typeof req.query.to === "string" ? req.query.to : "";

      const from = fromParam ? new Date(fromParam) : defaultFrom;
      const to = toParam ? new Date(toParam) : now;

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        res.status(400).json({ message: "Invalid date format. Use ISO 8601 (e.g. 2026-01-01)." });
        return;
      }

      to.setHours(23, 59, 59, 999);

      const scopeParam = typeof req.query.scope === "string" ? req.query.scope : "mine";
      const approverId = scopeParam === "all" ? undefined : authContext.userId;

      const overview = await getOverview(authContext.tenantId, from, to, approverId);
      res.json(overview);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
