import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";

export function createVendorsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/vendors", requireCap("canViewAllInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const query: Record<string, unknown> = { tenantId };

      if (typeof req.query.search === "string" && req.query.search.trim()) {
        query.name = { $regex: req.query.search.trim(), $options: "i" };
      }
      if (req.query.hasPan === "true") query.pan = { $ne: null };
      if (req.query.hasPan === "false") query.pan = null;
      if (req.query.hasMsme === "true") query["msme.udyamNumber"] = { $ne: null };

      const page = Math.max(Number(req.query.page ?? 1), 1);
      const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 100);
      const skip = (page - 1) * limit;

      const [items, total] = await Promise.all([
        VendorMasterModel.find(query)
          .select({ bankHistory: 0, aliases: 0, emailDomains: 0 })
          .sort({ lastInvoiceDate: -1 })
          .skip(skip).limit(limit).lean(),
        VendorMasterModel.countDocuments(query)
      ]);

      const summaries = items.map(v => ({
        _id: v._id,
        name: v.name,
        pan: v.pan ?? null,
        gstin: v.gstin ?? null,
        defaultGlCode: v.defaultGlCode ?? null,
        defaultTdsSection: v.defaultTdsSection ?? null,
        invoiceCount: v.invoiceCount,
        lastInvoiceDate: v.lastInvoiceDate,
        msme: v.msme?.classification ? { classification: v.msme.classification } : null,
        bankHistoryCount: 0
      }));

      res.json({ items: summaries, page, limit, total });
    } catch (error) { next(error); }
  });

  router.get("/vendors/:id", requireCap("canViewAllInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const vendor = await VendorMasterModel.findOne({ _id: req.params.id, tenantId }).lean();
      if (!vendor) { res.status(404).json({ message: "Vendor not found." }); return; }
      res.json(vendor);
    } catch (error) { next(error); }
  });

  return router;
}
