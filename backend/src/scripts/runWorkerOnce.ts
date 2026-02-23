import { connectToDatabase } from "../db/connect.js";
import { buildDependencies } from "../core/dependencies.js";
import { randomUUID } from "node:crypto";
import { logger, runWithLogContext } from "../utils/logger.js";

async function run() {
  await runWithLogContext(randomUUID(), async () => {
    await connectToDatabase();
    const dependencies = await buildDependencies();
    const summary = await dependencies.ingestionService.runOnce();
    logger.info("Ingestion run complete", { ...summary });
    process.exit(0);
  });
}

run().catch((error) => {
  logger.error("Ingestion run failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
