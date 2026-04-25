import { Router } from "express";
import { getAuth } from "@/types/auth.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import { isRecord, isString } from "@/utils/validation.js";
import { HttpError } from "@/errors/HttpError.js";

/**
 * Admin CRUD for `ClientOrganization` (#174). Tenant-scoped — does not
 * use `requireActiveClientOrg`, since these endpoints are themselves
 * the source of truth the FE realm-switcher reads from.
 */
export function createClientOrgsRouter(service: ClientOrgsAdminService) {
  const router = Router();

  router.get("/admin/client-orgs", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const items = await service.list(getAuth(req).tenantId);
      res.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/client-orgs", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      if (!isString(body.gstin) || !isString(body.companyName)) {
        throw new HttpError("gstin and companyName are required.", 400, "client_org_invalid_input");
      }
      const created = await service.create({
        tenantId: getAuth(req).tenantId,
        gstin: body.gstin,
        companyName: body.companyName,
        stateName: isString(body.stateName) ? body.stateName : undefined,
        companyGuid: isString(body.companyGuid) ? body.companyGuid : undefined
      });
      res.status(201).json(created);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/client-orgs/:id", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const body = isRecord(req.body) ? req.body : {};
      // GSTIN is the natural key with `tenantId` — immutable per #174.
      if ("gstin" in body) {
        throw new HttpError("gstin is immutable.", 400, "client_org_gstin_immutable");
      }
      const updated = await service.update({
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.params.id,
        companyName: isString(body.companyName) ? body.companyName : undefined,
        stateName: isString(body.stateName) ? body.stateName : undefined,
        companyGuid: isString(body.companyGuid) ? body.companyGuid : undefined,
        f12OverwriteByGuidVerified:
          typeof body.f12OverwriteByGuidVerified === "boolean"
            ? body.f12OverwriteByGuidVerified
            : undefined
      });
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/client-orgs/:id", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const result = await service.deleteOrArchive({
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.params.id
      });
      // Soft-archive yields 200 + linked-counts; hard-delete returns 200 + status.
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
