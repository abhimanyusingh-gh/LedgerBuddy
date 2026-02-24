import { Router } from "express";
import { env } from "../config/env.js";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.json({
    ok: true,
    ready: true,
    env: env.ENV,
    timestamp: new Date().toISOString()
  });
});
