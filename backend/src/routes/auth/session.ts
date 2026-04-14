import { Router } from "express";
import type { AuthService } from "@/auth/AuthService.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { mergeCapabilitiesWithDefaults } from "@/auth/personaDefaults.js";

export function createSessionRouter(authService: AuthService) {
  const router = Router();

  router.get("/session", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }

      const [flags, tenantDoc, userRoleDoc] = await Promise.all([
        authService.getSessionFlags(context),
        TenantModel.findById(context.tenantId).select({ mode: 1 }).lean(),
        TenantUserRoleModel.findOne({ tenantId: context.tenantId, userId: context.userId }).lean()
      ]);

      const rawRoleDoc = userRoleDoc as Record<string, unknown> | null;
      const roleForDefaults = typeof rawRoleDoc?.role === "string" ? rawRoleDoc.role : context.role;
      const capabilities = mergeCapabilitiesWithDefaults(
        roleForDefaults,
        rawRoleDoc?.capabilities as Record<string, unknown> | null | undefined
      );

      response.json({
        user: {
          id: context.userId,
          email: context.email,
          role: context.role,
          isPlatformAdmin: context.isPlatformAdmin,
          capabilities
        },
        tenant: {
          id: context.tenantId,
          name: context.tenantName,
          onboarding_status: context.onboardingStatus,
          mode: tenantDoc?.mode ?? "test"
        },
        flags
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
