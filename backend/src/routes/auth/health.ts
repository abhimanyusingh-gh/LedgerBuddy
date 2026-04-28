import { Router } from "express";
import mongoose from "mongoose";
import axios from "axios";
import { env } from "@/config/env.js";
import { OCR_PROVIDER_NAME } from "@/constants.js";
import { HEALTH_CHECK_STATUS } from "@/types/health.js";
import { getFeatureFlagEvaluator } from "@/services/flags/featureFlagEvaluator.js";
import { logger } from "@/utils/logger.js";
import { PLATFORM_URL_PATHS } from "@/routes/urls/platformUrls.js";

export const healthRouter = Router();

healthRouter.get(PLATFORM_URL_PATHS.healthRoot, async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const [ocrOk, slmOk] = await Promise.all([
    env.OCR_PROVIDER === OCR_PROVIDER_NAME.LLAMAPARSE ? Promise.resolve(true) : probeService(env.OCR_PROVIDER_BASE_URL),
    probeService(env.FIELD_VERIFIER_BASE_URL)
  ]);
  const checks = {
    mongo: mongoOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL,
    ocr: ocrOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL,
    slm: slmOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL
  };
  const ready = mongoOk && ocrOk && slmOk;

  const verbose = await getFeatureFlagEvaluator()
    .evaluateGlobal("example.healthCheckVerbose")
    .catch(() => false);
  if (verbose) {
    logger.info("health.checks", { ready, checks });
  }

  res.status(ready ? 200 : 503).json({
    ok: ready,
    ready,
    env: env.ENV,
    timestamp: new Date().toISOString(),
    checks
  });
});

healthRouter.get(PLATFORM_URL_PATHS.healthReady, async (_req, res) => {
  const mongoOk = mongoose.connection.readyState === 1;
  const [ocrOk, slmOk] = await Promise.all([
    env.OCR_PROVIDER === OCR_PROVIDER_NAME.LLAMAPARSE ? Promise.resolve(true) : probeService(env.OCR_PROVIDER_BASE_URL),
    probeService(env.FIELD_VERIFIER_BASE_URL)
  ]);
  const ready = mongoOk && ocrOk && slmOk;
  res.status(ready ? 200 : 503).json({
    ready,
    checks: {
      mongo: mongoOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL,
      ocr: ocrOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL,
      slm: slmOk ? HEALTH_CHECK_STATUS.OK : HEALTH_CHECK_STATUS.FAIL
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
