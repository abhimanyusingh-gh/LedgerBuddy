import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { TenantComplianceConfigModel } from "../models/TenantComplianceConfig.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";

export function createTenantComplianceConfigRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/compliance-config", requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      let config = await TenantComplianceConfigModel.findOne({ tenantId }).lean();

      if (!config) {
        const created = await TenantComplianceConfigModel.create({ tenantId });
        res.json(created.toObject());
        return;
      }

      res.json(config);
    } catch (error) { next(error); }
  });

  router.put("/admin/compliance-config", requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const update: Record<string, unknown> = {};

      if (typeof req.body.complianceEnabled === "boolean") update.complianceEnabled = req.body.complianceEnabled;
      if (typeof req.body.autoSuggestGlCodes === "boolean") update.autoSuggestGlCodes = req.body.autoSuggestGlCodes;
      if (typeof req.body.autoDetectTds === "boolean") update.autoDetectTds = req.body.autoDetectTds;
      if (Array.isArray(req.body.enabledSignals)) update.enabledSignals = req.body.enabledSignals;
      if (Array.isArray(req.body.disabledSignals)) update.disabledSignals = req.body.disabledSignals;
      if (typeof req.body.signalSeverityOverrides === "object" && req.body.signalSeverityOverrides !== null) {
        update.signalSeverityOverrides = req.body.signalSeverityOverrides;
      }
      if (req.body.defaultTdsSection !== undefined) update.defaultTdsSection = req.body.defaultTdsSection || null;

      const config = await TenantComplianceConfigModel.findOneAndUpdate(
        { tenantId },
        { $set: update },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      res.json(config!.toObject());
    } catch (error) { next(error); }
  });

  return router;
}
