import { Router } from "express";
import type { AuthService } from "../auth/AuthService.js";
import { TenantModel } from "../models/Tenant.js";

export function createSessionRouter(authService: AuthService) {
  const router = Router();

  router.get("/session", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }

      const [flags, tenantDoc] = await Promise.all([
        authService.getSessionFlags(context),
        TenantModel.findById(context.tenantId).select({ mode: 1 }).lean()
      ]);
      response.json({
        user: {
          id: context.userId,
          email: context.email,
          role: context.role,
          isPlatformAdmin: context.isPlatformAdmin
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
