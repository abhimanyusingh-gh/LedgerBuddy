import { Router } from "express";
import type { AuthService } from "../auth/AuthService.js";
import { requireTenantAdmin } from "../auth/middleware.js";
import type { TenantGmailIntegrationService } from "../services/tenantGmailIntegrationService.js";
import { logger } from "../utils/logger.js";

export function createGmailConnectionRouter(
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
      if (context.role !== "TENANT_ADMIN") {
        response.status(403).send("Tenant admin role required.");
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

  router.get("/api/integrations/gmail", async (request, response, next) => {
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

  router.get("/api/mailbox/gmail/connection", async (request, response, next) => {
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

  router.get("/api/integrations/gmail/connect-url", requireTenantAdmin, async (request, response, next) => {
    try {
      const context = request.authContext!;
      const sessionToken = request.header("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
      if (!sessionToken) {
        response.status(401).json({ message: "Missing bearer token." });
        return;
      }

      const connectUrl = new URL("/connect/gmail", `${request.protocol}://${request.get("host")}`);
      connectUrl.searchParams.set("token", sessionToken);
      response.json({ connectUrl: connectUrl.toString(), tenantId: context.tenantId });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
