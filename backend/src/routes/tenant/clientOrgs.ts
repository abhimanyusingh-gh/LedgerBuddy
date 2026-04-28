import { Router } from "express";
import { getAuth } from "@/types/auth.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import { isRecord, isString } from "@/utils/validation.js";
import { HttpError } from "@/errors/HttpError.js";

export function createClientOrgsRouter(service: ClientOrgsAdminService) {
  const router = Router();

  router.get("/admin/client-orgs", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const includeArchived = req.query.includeArchived === "true";
      const items = await service.list(getAuth(req).tenantId, { includeArchived });
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
      const updated = await service.update({
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.params.id,
        gstin: "gstin" in body ? body.gstin : undefined,
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

  router.get("/admin/client-orgs/:id/preview-archive", requireCap("canManageUsers"), async (req, res, next) => {
    try {
      const result = await service.previewArchive({
        tenantId: getAuth(req).tenantId,
        clientOrgId: req.params.id
      });
      res.json(result);
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
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
