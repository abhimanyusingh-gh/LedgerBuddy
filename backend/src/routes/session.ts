import { Router } from "express";
import type { AuthService } from "../auth/AuthService.js";

export function createSessionRouter(authService: AuthService) {
  const router = Router();

  router.get("/session", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }

      const flags = await authService.getSessionFlags(context);
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
          onboarding_status: context.onboardingStatus
        },
        flags
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
