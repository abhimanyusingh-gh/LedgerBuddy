import { Router } from "express";
import { requirePlatformAdmin } from "@/auth/middleware.js";
import type { PlatformAdminService } from "@/services/platform/platformAdminService.js";
import { scanAllWorkflows } from "@/services/invoice/workflowHealthScanner.js";
import { PLATFORM_URL_PATHS } from "@/routes/urls/platformUrls.js";

export function createPlatformAdminRouter(platformAdminService: PlatformAdminService) {
  const router = Router();

  router.post(PLATFORM_URL_PATHS.platformTenantsOnboardAdmin, requirePlatformAdmin, async (request, response, next) => {
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

  router.patch(PLATFORM_URL_PATHS.platformTenantEnabled, requirePlatformAdmin, async (request, response, next) => {
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

  router.get(PLATFORM_URL_PATHS.platformTenantsUsage, requirePlatformAdmin, async (_request, response, next) => {
    try {
      const items = await platformAdminService.listTenantUsageOverview();
      response.json({ items });
    } catch (error) {
      next(error);
    }
  });

  router.get(PLATFORM_URL_PATHS.adminWorkflowHealth, requirePlatformAdmin, async (_request, response, next) => {
    try {
      const report = await scanAllWorkflows();
      response.json(report);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
