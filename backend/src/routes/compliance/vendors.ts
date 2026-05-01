import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import { requireNotViewer } from "@/auth/middleware.js";
import { COMPLIANCE_URL_PATHS } from "@/routes/urls/complianceUrls.js";
import type { VendorMasterService } from "@/services/compliance/VendorMasterService.js";
import type { AuditLogService } from "@/services/core/AuditLogService.js";
import { VendorStatuses, type VendorStatus } from "@/types/vendor.js";

const MSME_STATUTORY_MAX_DAYS = 45;

export function createVendorsRouter(
  vendorMasterService: VendorMasterService,
  auditLogService: AuditLogService
) {
  const router = Router();
  router.use(requireAuth);

  router.get(COMPLIANCE_URL_PATHS.vendors, requireCap("canViewAllInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const query: Record<string, unknown> = { tenantId, clientOrgId: req.activeClientOrgId };

      if (typeof req.query.search === "string" && req.query.search.trim()) {
        const escaped = req.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.name = { $regex: escaped, $options: "i" };
      }
      if (req.query.hasPan === "true") query.pan = { $ne: null };
      if (req.query.hasPan === "false") query.pan = null;
      if (req.query.hasMsme === "true") query["msme.udyamNumber"] = { $ne: null };

      const statusFilter = parseStatusFilter(req.query.status);
      if (statusFilter) query.vendorStatus = statusFilter;

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
        vendorStatus: v.vendorStatus,
        msme: v.msme?.classification ? { classification: v.msme.classification, agreedPaymentDays: v.msme.agreedPaymentDays ?? null } : null,
        bankHistoryCount: 0
      }));

      res.json({ items: summaries, page, limit, total });
    } catch (error) { next(error); }
  });

  router.get(COMPLIANCE_URL_PATHS.vendorById, requireCap("canViewAllInvoices"), async (req, res, next) => {
    try {
      const tenantId = getAuth(req).tenantId;
      const vendor = await VendorMasterModel.findOne({ _id: req.params.id, tenantId, clientOrgId: req.activeClientOrgId }).lean();
      if (!vendor) { res.status(404).json({ message: "Vendor not found." }); return; }
      res.json(vendor);
    } catch (error) { next(error); }
  });

  router.patch(COMPLIANCE_URL_PATHS.vendorById, requireNotViewer, requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const auth = getAuth(req);
      const tenantId = auth.tenantId;
      const vendor = await VendorMasterModel.findOne({ _id: req.params.id, tenantId, clientOrgId: req.activeClientOrgId });
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
          clientOrgId: req.activeClientOrgId,
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

      const editableFields = pickVendorEditableFields(body);
      if (Object.keys(editableFields).length > 0) {
        try {
          await vendorMasterService.updateVendor(
            { tenantId, clientOrgId: req.activeClientOrgId! },
            req.params.id,
            editableFields,
            { userId: auth.userId, userEmail: auth.email },
            auditLogService
          );
        } catch (validationError) {
          res.status(400).json({ message: (validationError as Error).message });
          return;
        }
      }

      const updated = await VendorMasterModel.findOne({ _id: req.params.id, tenantId, clientOrgId: req.activeClientOrgId }).lean();
      res.json(updated);
    } catch (error) { next(error); }
  });

  router.post(COMPLIANCE_URL_PATHS.vendorSection197Cert, requireNotViewer, requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const auth = getAuth(req);
      const body = req.body as Record<string, unknown>;
      const cert = parseCertInput(body);
      if (!cert.ok) {
        res.status(400).json({ message: cert.error });
        return;
      }

      try {
        const updated = await vendorMasterService.uploadSection197Cert(
          { tenantId: auth.tenantId, clientOrgId: req.activeClientOrgId! },
          req.params.id,
          cert.value,
          { userId: auth.userId, userEmail: auth.email },
          auditLogService
        );
        if (!updated) {
          res.status(404).json({ message: "Vendor not found." });
          return;
        }
        res.json(updated.toObject());
      } catch (validationError) {
        res.status(400).json({ message: (validationError as Error).message });
      }
    } catch (error) { next(error); }
  });

  router.post(COMPLIANCE_URL_PATHS.vendorMerge, requireNotViewer, requireCap("canConfigureCompliance"), async (req, res, next) => {
    try {
      const auth = getAuth(req);
      const body = req.body as Record<string, unknown>;
      const sourceVendorId = typeof body.sourceVendorId === "string" ? body.sourceVendorId : null;

      if (!sourceVendorId) {
        res.status(400).json({ message: "sourceVendorId is required." });
        return;
      }

      try {
        const result = await vendorMasterService.mergeVendors(
          {
            scope: { tenantId: auth.tenantId, clientOrgId: req.activeClientOrgId! },
            targetVendorId: req.params.id,
            sourceVendorId,
            actor: { userId: auth.userId, userEmail: auth.email }
          },
          auditLogService
        );
        res.json(result);
      } catch (mergeError) {
        const message = (mergeError as Error).message;
        if (message.includes("not found")) {
          res.status(404).json({ message });
        } else {
          res.status(400).json({ message });
        }
      }
    } catch (error) { next(error); }
  });

  return router;
}

function parseStatusFilter(raw: unknown): VendorStatus | null {
  if (typeof raw !== "string") return null;
  return (VendorStatuses as readonly string[]).includes(raw) ? (raw as VendorStatus) : null;
}

const VENDOR_EDITABLE_FIELD_NAMES = [
  "name",
  "pan",
  "gstin",
  "defaultGlCode",
  "defaultCostCenter",
  "defaultTdsSection",
  "tallyLedgerName",
  "tallyLedgerGroup",
  "vendorStatus",
  "deducteeType",
  "stateCode",
  "stateName"
] as const;

function pickVendorEditableFields(body: Record<string, unknown>): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of VENDOR_EDITABLE_FIELD_NAMES) {
    if (key in body) picked[key] = body[key];
  }
  return picked;
}

interface ParseCertOk {
  ok: true;
  value: {
    certificateNumber: string;
    validFrom: Date;
    validTo: Date;
    maxAmountMinor: number;
    applicableRateBps: number;
  };
}

interface ParseCertErr {
  ok: false;
  error: string;
}

function parseCertInput(body: Record<string, unknown>): ParseCertOk | ParseCertErr {
  const certificateNumber = typeof body.certificateNumber === "string" ? body.certificateNumber.trim() : "";
  if (!certificateNumber) return { ok: false, error: "certificateNumber is required." };

  const validFromRaw = body.validFrom;
  const validToRaw = body.validTo;
  const validFrom = typeof validFromRaw === "string" || validFromRaw instanceof Date ? new Date(validFromRaw) : null;
  const validTo = typeof validToRaw === "string" || validToRaw instanceof Date ? new Date(validToRaw) : null;

  if (!validFrom || isNaN(validFrom.getTime())) return { ok: false, error: "validFrom must be a valid ISO date." };
  if (!validTo || isNaN(validTo.getTime())) return { ok: false, error: "validTo must be a valid ISO date." };

  const maxAmountMinor = Number(body.maxAmountMinor);
  const applicableRateBps = Number(body.applicableRateBps);

  if (!Number.isInteger(maxAmountMinor) || maxAmountMinor < 0) {
    return { ok: false, error: "maxAmountMinor must be a non-negative integer." };
  }
  if (!Number.isInteger(applicableRateBps) || applicableRateBps < 0 || applicableRateBps > 10000) {
    return { ok: false, error: "applicableRateBps must be an integer between 0 and 10000." };
  }

  return { ok: true, value: { certificateNumber, validFrom, validTo, maxAmountMinor, applicableRateBps } };
}
