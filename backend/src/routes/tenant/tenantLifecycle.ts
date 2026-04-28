import { getAuth } from "@/types/auth.js";
import { Router, type RequestHandler } from "express";
import { requireCap } from "@/auth/requireCapability.js";
import { TENANT_URL_PATHS } from "@/routes/urls/tenantUrls.js";
import type { TenantAdminService } from "@/services/tenant/tenantAdminService.js";
import type { TenantInviteService } from "@/services/tenant/tenantInviteService.js";

function buildOnboardingCompleteHandler(tenantAdminService: TenantAdminService): RequestHandler {
  return async (request, response, next) => {
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
  };
}

// Nested-tree mount under `tenantAdminRouter` (already prefixed
// `/api/tenants/:tenantId/`) — registers JUST the onboarding-complete route at
// `/onboarding/complete` so the resolved URL is the clean
// `/api/tenants/:tenantId/onboarding/complete` (no double `tenant`).
export function createTenantOnboardingCompleteRouter(tenantAdminService: TenantAdminService) {
  const router = Router();
  router.post(TENANT_URL_PATHS.onboardingCompleteNested, requireCap("canManageUsers"), buildOnboardingCompleteHandler(tenantAdminService));
  return router;
}

// Legacy `/api`-prefixed mount — keeps the historical
// `/api/tenant/onboarding/complete` shape AND the
// `/api/tenant/invites/accept` route. Sub-PR F drops this once zero callers
// remain on the legacy onboarding URL.
export function createTenantLifecycleRouter(tenantAdminService: TenantAdminService, inviteService: TenantInviteService) {
  const router = Router();

  router.post(TENANT_URL_PATHS.onboardingCompleteLegacy, requireCap("canManageUsers"), buildOnboardingCompleteHandler(tenantAdminService));

  router.post(TENANT_URL_PATHS.inviteAccept, async (request, response, next) => {
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
