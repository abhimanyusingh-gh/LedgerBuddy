import type { Server } from "node:http";
import { createApp } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/connect.js";
import { closeRedisClient } from "./db/redis.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { seedLocalDemoData } from "./bootstrap/seedLocalDemoData.js";
import { buildDependencies } from "./core/dependencies.js";
import { TenantModel } from "./models/core/Tenant.js";

let server: Server | undefined;
let shuttingDown = false;
let pollingTimer: ReturnType<typeof setTimeout> | undefined;

const POLLING_TICK_INTERVAL_MS = 60_000;

async function bootstrap() {
  await connectToDatabase();

  const dependencies = await buildDependencies();

  if (env.LOCAL_DEMO_SEED) {
    await seedLocalDemoData(dependencies.keycloakAdmin);
  }

  const app = await createApp(dependencies);
  server = app.listen(env.PORT, () => {
    logger.info("Backend listening", { port: env.PORT });
  });

  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  function scheduleNextPoll() {
    pollingTimer = setTimeout(async () => {
      try {
        await runPollingTick(dependencies);
      } catch (error) {
        logger.error("polling.tick.failed", { error: error instanceof Error ? error.message : String(error) });
      }
      if (!shuttingDown) {
        scheduleNextPoll();
      }
    }, POLLING_TICK_INTERVAL_MS);
  }
  scheduleNextPoll();
}

async function runPollingTick(dependencies: Awaited<ReturnType<typeof buildDependencies>>): Promise<void> {
  const eligible = await dependencies.gmailIntegrationService.getPollingEligibleIntegrations();
  if (eligible.length === 0) return;

  for (const { tenantId, integrationId } of eligible) {
    try {
      const tenant = await TenantModel.findById(tenantId).select({ mode: 1 }).lean();
      if (tenant?.mode === "test") {
        logger.info("polling.skipped.test-tenant", { tenantId });
        continue;
      }
      await dependencies.ingestionService.runOnce({ tenantId });
      await dependencies.gmailIntegrationService.markPollingCompleted(integrationId);
      logger.info("polling.completed", { tenantId, integrationId });
    } catch (error) {
      logger.error("polling.tenant.failed", {
        tenantId,
        integrationId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("shutdown.start", { signal });

  if (pollingTimer) {
    clearTimeout(pollingTimer);
  }

  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    logger.info("shutdown.server.closed");
  }

  await disconnectFromDatabase();
  logger.info("shutdown.db.disconnected");

  await closeRedisClient();
  logger.info("shutdown.redis.disconnected");

  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error("unhandledRejection", {
    error: reason instanceof Error ? reason.message : String(reason)
  });
});

bootstrap().catch((error) => {
  logger.error("Failed to start backend", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
