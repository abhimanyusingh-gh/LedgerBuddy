import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { CostCenterMasterModel } from "@/models/compliance/CostCenterMaster.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";

export function createCostCentersRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/cost-centers", async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const query: Record<string, unknown> = { tenantId };
      if (req.query.active === "true") query.isActive = true;

      const items = await CostCenterMasterModel.find(query).sort({ code: 1 }).lean();
      res.json({ items, total: items.length });
    } catch (error) { next(error); }
  });

  router.post("/admin/cost-centers", requireCap("canManageCostCenters"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const { code, name, department, linkedGlCodes } = req.body ?? {};
      if (!code?.trim() || !name?.trim()) {
        res.status(400).json({ message: "Code and name are required." });
        return;
      }

      const existing = await CostCenterMasterModel.findOne({ tenantId, code: code.trim() });
      if (existing) {
        res.status(409).json({ message: `Cost center "${code.trim()}" already exists.` });
        return;
      }

      const doc = await CostCenterMasterModel.create({
        tenantId,
        code: code.trim(),
        name: name.trim(),
        department: department?.trim() || null,
        linkedGlCodes: Array.isArray(linkedGlCodes) ? linkedGlCodes : []
      });

      res.status(201).json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.put("/admin/cost-centers/:code", requireCap("canManageCostCenters"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const update: Record<string, unknown> = {};
      if (typeof req.body.name === "string") update.name = req.body.name.trim();
      if (typeof req.body.department === "string") update.department = req.body.department.trim() || null;
      if (Array.isArray(req.body.linkedGlCodes)) update.linkedGlCodes = req.body.linkedGlCodes;
      if (typeof req.body.isActive === "boolean") update.isActive = req.body.isActive;

      const doc = await CostCenterMasterModel.findOneAndUpdate(
        { tenantId, code: req.params.code },
        { $set: update },
        { new: true }
      );
      if (!doc) { res.status(404).json({ message: "Cost center not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.delete("/admin/cost-centers/:code", requireCap("canManageCostCenters"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const doc = await CostCenterMasterModel.findOneAndUpdate(
        { tenantId, code: req.params.code },
        { $set: { isActive: false } },
        { new: true }
      );
      if (!doc) { res.status(404).json({ message: "Cost center not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  return router;
}
