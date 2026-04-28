import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@/types/auth.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { TriageService } from "@/services/invoice/triageService.js";
import { isRecord } from "@/utils/validation.js";
import { TRIAGE_URL_PATHS } from "@/routes/urls/triageUrls.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function wrap(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

export function createTriageRouter(service: TriageService) {
  const router = Router();
  router.use(requireAuth);

  router.get(
    TRIAGE_URL_PATHS.list,
    requireCap("canViewAllInvoices"),
    wrap(async (req, res) => {
      const result = await service.list(getAuth(req).tenantId);
      res.json(result);
    })
  );

  router.patch(
    TRIAGE_URL_PATHS.assignClientOrg,
    requireCap("canEditInvoiceFields"),
    wrap(async (req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      await service.assignClientOrg({
        tenantId: getAuth(req).tenantId,
        invoiceId: req.params.id,
        clientOrgId: typeof body.clientOrgId === "string" ? body.clientOrgId : ""
      });
      res.json({ ok: true });
    })
  );

  router.patch(
    TRIAGE_URL_PATHS.reject,
    requireCap("canEditInvoiceFields"),
    wrap(async (req, res) => {
      const body = isRecord(req.body) ? req.body : {};
      await service.reject({
        tenantId: getAuth(req).tenantId,
        invoiceId: req.params.id,
        reasonCode: body.reasonCode,
        notes: body.notes
      });
      res.json({ ok: true });
    })
  );

  return router;
}
