import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import { requireCap } from "@/auth/requireCapability.js";
import type { TenantAdminService } from "@/services/tenant/tenantAdminService.js";
import type { TenantInviteService } from "@/services/tenant/tenantInviteService.js";

export function createTenantLifecycleRouter(tenantAdminService: TenantAdminService, inviteService: TenantInviteService) {
  const router = Router();

  router.post("/tenant/onboarding/complete", requireCap("canManageUsers"), async (request, response, next) => {
    try {
      const context = getAuth(request);
      const tenantName = typeof request.body?.tenantName === "string" ? request.body.tenantName : "";
      const adminEmail = typeof request.body?.adminEmail === "string" ? request.body.adminEmail : context.email;

      await tenantAdminService.completeOnboarding({
        tenantId: context.tenantId,
        tenantName,
        adminEmail
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  router.post("/tenant/invites/accept", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }

      const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
      if (!token) {
        response.status(400).json({ message: "Invite token is required." });
        return;
      }

      await inviteService.acceptInvite({
        token,
        userId: context.userId
      });
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
