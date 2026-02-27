import { Router } from "express";
import type { GmailMailboxConnectionService } from "../services/gmailMailboxConnectionService.js";
import { logger } from "../utils/logger.js";
import { resolveRequestUserId } from "../utils/requestUser.js";

export function createGmailConnectionRouter(gmailConnectionService: GmailMailboxConnectionService) {
  const router = Router();

  router.get("/connect/gmail", async (req, res, next) => {
    try {
      const userId = resolveRequestUserId(req);
      const redirectUrl = await gmailConnectionService.createConnectUrl(userId);
      res.redirect(302, redirectUrl);
    } catch (error) {
      next(error);
    }
  });

  router.get("/connect/gmail/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
    const state = typeof req.query.state === "string" ? req.query.state.trim() : "";
    if (!code || !state) {
      res.redirect(302, gmailConnectionService.buildFailureRedirectUrl("missing_code_or_state"));
      return;
    }

    try {
      await gmailConnectionService.handleOAuthCallback(code, state);
      res.redirect(302, gmailConnectionService.buildSuccessRedirectUrl());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "oauth_callback_failed";
      logger.error("gmail.connection.callback.failed", { reason });
      res.redirect(302, gmailConnectionService.buildFailureRedirectUrl(reason));
    }
  });

  router.get("/api/mailbox/gmail/connection", async (req, res, next) => {
    try {
      const userId = resolveRequestUserId(req);
      const status = await gmailConnectionService.getConnectionStatus(userId);
      res.json(status);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
