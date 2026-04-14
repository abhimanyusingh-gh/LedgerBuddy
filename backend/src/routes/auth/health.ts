import { Router } from "express";
import mongoose from "mongoose";
import axios from "axios";
import { env } from "@/config/env.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const [ocrOk, slmOk] = await Promise.all([
    env.OCR_PROVIDER === "llamaparse" ? Promise.resolve(true) : probeService(env.OCR_PROVIDER_BASE_URL),
    probeService(env.FIELD_VERIFIER_BASE_URL)
  ]);
  const ready = mongoOk && ocrOk && slmOk;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    ready,
    env: env.ENV,
    timestamp: new Date().toISOString(),
    checks: {
      mongo: mongoOk ? "ok" : "fail",
      ocr: ocrOk ? "ok" : "fail",
      slm: slmOk ? "ok" : "fail"
    }
  });
});

healthRouter.get("/health/ready", async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const [ocrOk, slmOk] = await Promise.all([
    env.OCR_PROVIDER === "llamaparse" ? Promise.resolve(true) : probeService(env.OCR_PROVIDER_BASE_URL),
    probeService(env.FIELD_VERIFIER_BASE_URL)
  ]);
  const ready = mongoOk && ocrOk && slmOk;
  res.status(ready ? 200 : 503).json({
    ready,
    checks: {
      mongo: mongoOk ? "ok" : "fail",
      ocr: ocrOk ? "ok" : "fail",
      slm: slmOk ? "ok" : "fail"
    }
  });
});

async function probeService(baseUrl: string | undefined): Promise<boolean> {
  if (!baseUrl) {
    return false;
  }
  try {
    const origin = new URL(baseUrl).origin;
    const response = await axios.get(`${origin}/health`, { timeout: 3000 });
    return response.status === 200;
  } catch {
    return false;
  }
}
