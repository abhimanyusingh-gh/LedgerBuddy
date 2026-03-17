import type { Server } from "node:http";
import { createApp } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/connect.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { seedLocalDemoData } from "./bootstrap/seedLocalDemoData.js";
import { buildDependencies } from "./core/dependencies.js";

let server: Server | undefined;
let shuttingDown = false;

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
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info("shutdown.start", { signal });

  if (server) {
    await new Promise<void>((resolve) => {
      server!.close(() => resolve());
    });
    logger.info("shutdown.server.closed");
  }

  await disconnectFromDatabase();
  logger.info("shutdown.db.disconnected");

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
