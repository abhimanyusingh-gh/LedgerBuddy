import { Router } from "express";
import mongoose from "mongoose";
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

healthRouter.get("/health/ready", (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const ready = mongoOk;
  res.status(ready ? 200 : 503).json({
    ready,
    checks: {
      mongo: mongoOk ? "ok" : "fail"
    }
  });
});
