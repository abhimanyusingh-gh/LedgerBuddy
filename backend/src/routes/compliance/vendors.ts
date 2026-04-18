import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { requireNotViewer } from "@/auth/middleware.js";

const MSME_STATUTORY_MAX_DAYS = 45;

export function createVendorsRouter() {
  const router = Router();
  router.use(requireAuth);

  router.get("/vendors", requireCap("canViewAllInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const query: Record<string, unknown> = { tenantId };

      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.name = { $regex: escaped, $options: "i" };
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
        msme: v.msme?.classification ? { classification: v.msme.classification, agreedPaymentDays: v.msme.agreedPaymentDays ?? null } : null,
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

  router.patch("/vendors/:id", requireNotViewer, requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const vendor = await VendorMasterModel.findOne({ _id: req.params.id, tenantId });
      if (!vendor) { res.status(404).json({ message: "Vendor not found." }); return; }

      const body = req.body as Record<string, unknown>;
      const msmeBody = body.msme as Record<string, unknown> | undefined;

      if (msmeBody && "agreedPaymentDays" in msmeBody) {
        const raw = msmeBody.agreedPaymentDays;
        if (raw !== null) {
          const days = Number(raw);
          if (!Number.isInteger(days) || days < 1 || days > 365) {
            res.status(400).json({ message: "agreedPaymentDays must be an integer between 1 and 365." });
            return;
          }
          vendor.set("msme.agreedPaymentDays", days);
        } else {
          vendor.set("msme.agreedPaymentDays", null);
        }
        await vendor.save();

        const effectiveDays = Math.min(vendor.msme?.agreedPaymentDays ?? MSME_STATUTORY_MAX_DAYS, MSME_STATUTORY_MAX_DAYS);
        const fingerprint = vendor.vendorFingerprint;

        const unpaidInvoices = await InvoiceModel.find({
          tenantId,
          "metadata.vendorFingerprint": fingerprint,
          status: { $nin: ["EXPORTED"] }
        }).select({ "parsed.invoiceDate": 1 });

        const bulkOps = unpaidInvoices
          .filter(inv => inv.parsed?.invoiceDate)
          .map(inv => {
            const invDate = new Date(inv.parsed!.invoiceDate!);
            if (isNaN(invDate.getTime())) return null;
            const deadline = new Date(invDate.getTime() + effectiveDays * 86400000);
            return {
              updateOne: {
                filter: { _id: inv._id },
                update: { $set: { "compliance.msme.paymentDeadline": deadline } }
              }
            };
          })
          .filter(Boolean);

        if (bulkOps.length > 0) {
          await InvoiceModel.bulkWrite(bulkOps as NonNullable<typeof bulkOps[number]>[]);
        }
      }

      const updated = await VendorMasterModel.findOne({ _id: req.params.id, tenantId }).lean();
      res.json(updated);
    } catch (error) { next(error); }
  });

  return router;
}
