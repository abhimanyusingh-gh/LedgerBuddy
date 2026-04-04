import { getAuth } from "../types/auth.js";
import { Router } from "express";
import { GlCodeMasterModel } from "../models/GlCodeMaster.js";
import { requireAuth } from "../auth/requireAuth.js";
import { requireCap } from "../auth/requireCapability.js";

export function createGlCodesRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/admin/gl-codes", async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const query: Record<string, unknown> = { tenantId };

      if (typeof req.query.category === "string") query.category = req.query.category;
      if (req.query.active === "true") query.isActive = true;
      if (req.query.active === "false") query.isActive = false;

      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const search = req.query.search.trim();
        query.$or = [
          { code: { $regex: search, $options: "i" } },
          { name: { $regex: search, $options: "i" } }
        ];
      }

      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        GlCodeMasterModel.find(query).sort({ code: 1 }).skip(skip).limit(limit).lean(),
        GlCodeMasterModel.countDocuments(query)
      ]);

      res.json({ items, page, limit, total });
    } catch (error) { next(error); }
  });

  router.post("/admin/gl-codes", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const { code, name, category, linkedTdsSection, parentCode } = req.body ?? {};

      if (!code?.trim() || !name?.trim()) {
        res.status(400).json({ message: "Code and name are required." });
        return;
      }

      const existing = await GlCodeMasterModel.findOne({ tenantId, code: code.trim() });
      if (existing) {
        res.status(409).json({ message: `GL code "${code.trim()}" already exists.` });
        return;
      }

      const doc = await GlCodeMasterModel.create({
        tenantId,
        code: code.trim(),
        name: name.trim(),
        category: category?.trim() ?? "Other",
        linkedTdsSection: linkedTdsSection?.trim() || null,
        parentCode: parentCode?.trim() || null
      });

      res.status(201).json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.put("/admin/gl-codes/:code", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const update: Record<string, unknown> = {};
      if (typeof req.body.name === "string") update.name = req.body.name.trim();
      if (typeof req.body.category === "string") update.category = req.body.category.trim();
      if (req.body.linkedTdsSection !== undefined) update.linkedTdsSection = req.body.linkedTdsSection?.trim() || null;
      if (req.body.parentCode !== undefined) update.parentCode = req.body.parentCode?.trim() || null;
      if (typeof req.body.isActive === "boolean") update.isActive = req.body.isActive;

      const doc = await GlCodeMasterModel.findOneAndUpdate(
        { tenantId, code: req.params.code },
        { $set: update },
        { new: true }
      );

      if (!doc) { res.status(404).json({ message: "GL code not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  router.delete("/admin/gl-codes/:code", requireCap("canConfigureGlCodes"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const doc = await GlCodeMasterModel.findOneAndUpdate(
        { tenantId, code: req.params.code },
        { $set: { isActive: false } },
        { new: true }
      );
      if (!doc) { res.status(404).json({ message: "GL code not found." }); return; }
      res.json(doc.toObject());
    } catch (error) { next(error); }
  });

  return router;
}
