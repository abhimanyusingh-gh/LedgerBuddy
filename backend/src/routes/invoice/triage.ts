import { Router, type Request, type Response, type NextFunction } from "express";
import { getAuth } from "@/types/auth.js";
import { requireAuth } from "@/auth/requireAuth.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { TriageService } from "@/services/invoice/triageService.js";
import { isRecord } from "@/utils/validation.js";

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function wrap(fn: AsyncHandler): AsyncHandler {
  return (req, res, next) => fn(req, res, next).catch(next);
}

/**
 * Triage queue endpoints (#179) — consumed by FE PRs #180 (queue UI),
 * #183 (sidebar count), #185, #186. Tenant-scoped only: these routes
 * MUST NOT use `requireActiveClientOrg` because PENDING_TRIAGE invoices
 * carry `clientOrgId: null` (the documented composite-key exception per
 * #156). The FE migrated-paths dispatcher in
 * `frontend/src/api/migratedPaths.ts` mirrors this with a tenant-scoped
 * bypass entry for `/invoices/triage` plus suffix bypasses for
 * `/assign-client-org` and `/reject`.
 */
export function createTriageRouter(service: TriageService) {
  const router = Router();
  router.use(requireAuth);

  router.get(
    "/invoices/triage",
    requireCap("canViewAllInvoices"),
    wrap(async (req, res) => {
      const result = await service.list(getAuth(req).tenantId);
      res.json(result);
    })
  );

  router.patch(
    "/invoices/:id/assign-client-org",
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
    "/invoices/:id/reject",
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
