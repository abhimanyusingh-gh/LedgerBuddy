import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { BankAccountModel } from "@/models/bank/BankAccount.js";
import type { IBankConnectionService } from "@/services/bank/anumati/IBankConnectionService.js";
import { logger } from "@/utils/logger.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env.js";

function verifyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
  const secret = env.WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    next();
    return;
  }

  const signature = req.headers["x-webhook-signature"];
  if (typeof signature !== "string" || !signature) {
    res.status(401).json({ message: "Missing webhook signature." });
    return;
  }

  const body = JSON.stringify(req.body);
  const expected = createHmac("sha256", secret).update(body).digest("hex");

  const sigBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    res.status(401).json({ message: "Invalid webhook signature." });
    return;
  }

  next();
}

export function createBankWebhooksRouter(bankService: IBankConnectionService) {
  const router = Router();

  router.get("/bank/aa-callback", async (req, res) => {
    const ecres = typeof req.query.ecres === "string" ? req.query.ecres : undefined;
    const iv = typeof req.query.iv === "string" ? req.query.iv : undefined;
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";

    try {
      await bankService.handleConsentCallback({ sessionId, success: true, ecres, iv });
      res.redirect(302, "/");
    } catch (error) {
      logger.warn("bank.aa-callback.error", { sessionId, error: error instanceof Error ? error.message : String(error) });
      res.redirect(302, "/?bank=error");
    }
  });

  router.get("/bank/mock-callback", async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
    const success = req.query.success !== "false";

    try {
      await bankService.handleConsentCallback({ sessionId, success });
      res.redirect(302, "/");
    } catch (error) {
      logger.warn("bank.mock-callback.error", { sessionId, error: error instanceof Error ? error.message : String(error) });
      res.redirect(302, "/?bank=error");
    }
  });

  // TODO: Add rate limiting to webhook endpoints (e.g. express-rate-limit) to prevent abuse (H6)
  router.post("/bank/consent-notify", verifyWebhookSignature, async (req, res) => {
    try {
      await bankService.handleConsentNotify(req.body);
      res.status(200).json({ status: "ok" });
    } catch (error) {
      logger.warn("bank.consent-notify.error", { error: error instanceof Error ? error.message : String(error) });
      res.status(200).json({ status: "ok" });
    }
  });

  router.post("/bank/fi-notify", verifyWebhookSignature, async (req, res) => {
    try {
      await bankService.handleFiNotify(req.body);
      res.status(200).json({ status: "ok" });
    } catch (error) {
      logger.warn("bank.fi-notify.error", { error: error instanceof Error ? error.message : String(error) });
      res.status(200).json({ status: "ok" });
    }
  });

  return router;
}
