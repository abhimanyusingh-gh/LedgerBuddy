import { getAuth } from "../../types/auth.js";
import { Router } from "express";
import { InvoiceModel } from "../../models/invoice/Invoice.js";
import { TenantModel } from "../../models/core/Tenant.js";
import { VendorCommunicationService } from "../../services/compliance/VendorCommunicationService.js";
import { requireAuth } from "../../auth/requireAuth.js";
import { requireCap } from "../../auth/requireCapability.js";

const vendorComms = new VendorCommunicationService();

export function createVendorCommunicationRouter() {
  const router = Router();
  router.use(requireAuth);

  router.post("/invoices/:id/vendor-email", requireCap("canSendVendorEmails"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const invoice = await InvoiceModel.findOne({ _id: req.params.id, tenantId });
      if (!invoice) { res.status(404).json({ message: "Invoice not found." }); return; }

      const trigger = typeof req.body?.trigger === "string" ? req.body.trigger : "";
      const vendorEmail = typeof req.body?.vendorEmail === "string" ? req.body.vendorEmail.trim() : "";
      if (!trigger || !vendorEmail) {
        res.status(400).json({ message: "trigger and vendorEmail are required." });
        return;
      }

      const tenant = await TenantModel.findById(tenantId).lean();
      const tenantName = tenant?.name ?? "BillForge";

      const draft = vendorComms.generateDraft(invoice, trigger, vendorEmail, tenantName);
      if (!draft) { res.status(400).json({ message: `Unsupported trigger: ${trigger}` }); return; }

      res.json(draft);
    } catch (error) { next(error); }
  });

  router.get("/admin/vendor-email-templates", async (_req, res) => {
    res.json({ triggers: vendorComms.getSupportedTriggers() });
  });

  return router;
}
