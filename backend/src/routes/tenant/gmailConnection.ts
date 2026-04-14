import { getAuth } from "@/types/auth.js";
import { Router } from "express";
import type { AuthService } from "@/auth/AuthService.js";
import { requireCap } from "@/auth/requireCapability.js";
import type { TenantGmailIntegrationService } from "@/services/tenant/tenantGmailIntegrationService.js";
import { logger } from "@/utils/logger.js";
import { apiUrl } from "@/config/env.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { mergeCapabilitiesWithDefaults } from "@/auth/personaDefaults.js";

/**
 * Public Gmail routes — mounted BEFORE the authenticate middleware.
 * These routes handle their own auth internally:
 * - /connect/gmail uses a ?token= query param and resolves context manually
 * - /connect/gmail/callback is an OAuth callback from KC and carries no auth token
 */
export function createGmailPublicRouter(
  gmailIntegrationService: TenantGmailIntegrationService,
  authService: AuthService
) {
  const router = Router();

  router.get("/connect/gmail", async (request, response, next) => {
    try {
      const token = typeof request.query.token === "string" ? request.query.token.trim() : "";
      if (!token) {
        response.status(401).send("Missing session token.");
        return;
      }

      const context = await authService.resolveRequestContext(token);
      const roleDoc = await TenantUserRoleModel.findOne({ tenantId: context.tenantId, userId: context.userId }).lean();
      const rawRoleDoc = roleDoc as Record<string, unknown> | null;
      const roleForDefaults = typeof rawRoleDoc?.role === "string" ? rawRoleDoc.role : context.role;
      const capabilities = mergeCapabilitiesWithDefaults(
        roleForDefaults,
        rawRoleDoc?.capabilities as Record<string, unknown> | null | undefined
      );
      if (capabilities.canManageConnections !== true) {
        response.status(403).send("Permission denied: canManageConnections is required.");
        return;
      }

      const redirectUrl = await gmailIntegrationService.createConnectUrl({
        tenantId: context.tenantId,
        userId: context.userId
      });
      response.redirect(302, redirectUrl);
    } catch (error) {
      next(error);
    }
  });

  router.get("/connect/gmail/callback", async (request, response) => {
    const code = typeof request.query.code === "string" ? request.query.code.trim() : "";
    const state = typeof request.query.state === "string" ? request.query.state.trim() : "";
    if (!code || !state) {
      response.redirect(302, gmailIntegrationService.buildFailureRedirectUrl("missing_code_or_state"));
      return;
    }

    try {
      await gmailIntegrationService.handleOAuthCallback(code, state);
      response.redirect(302, gmailIntegrationService.buildSuccessRedirectUrl());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "oauth_callback_failed";
      logger.error("gmail.connection.callback.failed", { reason });
      response.redirect(302, gmailIntegrationService.buildFailureRedirectUrl(reason));
    }
  });

  return router;
}

/**
 * Protected Gmail routes — mounted AFTER the authenticate middleware.
 * All routes here require a valid session (request.authContext set by authenticate).
 */
export function createGmailConnectionRouter(gmailIntegrationService: TenantGmailIntegrationService) {
  const router = Router();

  router.get("/integrations/gmail", async (request, response, next) => {
    try {
      const context = request.authContext;
      if (!context) {
        response.status(401).json({ message: "Authentication required." });
        return;
      }
      if (context.isPlatformAdmin) {
        response.status(403).json({ message: "Platform admins cannot access tenant mailbox connections." });
        return;
      }

      const status = await gmailIntegrationService.getConnectionStatus(context.tenantId);
      response.json({
        provider: "gmail",
        connectionState:
          status.status === "connected"
            ? "CONNECTED"
            : status.status === "requires_reauth"
              ? "NEEDS_REAUTH"
              : "DISCONNECTED",
        emailAddress: status.emailAddress || undefined,
        lastErrorReason: status.lastErrorReason || undefined,
        lastSyncedAt: status.lastSyncedAt || undefined
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/integrations/gmail/connect-url", requireCap("canManageConnections"), async (request, response, next) => {
    try {
      const context = getAuth(request);
      const sessionToken = request.header("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
      if (!sessionToken) {
        response.status(401).json({ message: "Missing bearer token." });
        return;
      }

      const connectUrl = `${apiUrl("/api/connect/gmail")}?token=${encodeURIComponent(sessionToken)}`;
      response.json({ connectUrl, tenantId: context.tenantId });
    } catch (error) {
      next(error);
    }
  });

  router.put("/integrations/gmail/:id/polling", requireCap("canManageConnections"), async (request, response, next) => {
    try {
      const context = getAuth(request);
      const enabled = typeof request.body?.enabled === "boolean" ? request.body.enabled : false;
      const intervalHours = typeof request.body?.intervalHours === "number" ? request.body.intervalHours : 4;
      await gmailIntegrationService.updatePollingConfig(request.params.id, context.tenantId, { enabled, intervalHours });
      response.json({ enabled, intervalHours });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
