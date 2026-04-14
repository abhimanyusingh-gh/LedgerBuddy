import { Router } from "express";
import { requirePlatformAdmin } from "@/auth/middleware.js";
import type { PlatformAdminService } from "@/services/platform/platformAdminService.js";

export function createPlatformAdminRouter(platformAdminService: PlatformAdminService) {
  const router = Router();

  router.post("/platform/tenants/onboard-admin", requirePlatformAdmin, async (request, response, next) => {
    try {
      const tenantName = typeof request.body?.tenantName === "string" ? request.body.tenantName : "";
      const adminEmail = typeof request.body?.adminEmail === "string" ? request.body.adminEmail : "";
      const adminDisplayName =
        typeof request.body?.adminDisplayName === "string" ? request.body.adminDisplayName : undefined;
      const rawMode = typeof request.body?.mode === "string" ? request.body.mode : undefined;
      const mode = rawMode === "test" || rawMode === "live" ? rawMode : undefined;
      const result = await platformAdminService.onboardTenantAdmin({
        tenantName,
        adminEmail,
        ...(adminDisplayName ? { displayName: adminDisplayName } : {}),
        ...(mode ? { mode } : {})
      });
      response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.patch("/platform/tenants/:tenantId/enabled", requirePlatformAdmin, async (request, response, next) => {
    try {
      const tenantId = request.params.tenantId;
      const enabled = request.body?.enabled;
      if (typeof enabled !== "boolean") {
        response.status(400).json({ message: "enabled must be a boolean.", code: "platform_invalid_input" });
        return;
      }
      await platformAdminService.setTenantEnabled(tenantId, enabled);
      response.json({ tenantId, enabled });
    } catch (error) {
      next(error);
    }
  });

  router.get("/platform/tenants/usage", requirePlatformAdmin, async (_request, response, next) => {
    try {
      const items = await platformAdminService.listTenantUsageOverview();
      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
