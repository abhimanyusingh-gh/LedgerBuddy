import mongoose from "mongoose";
import { loadRuntimeManifest } from "../core/runtimeManifest.js";
import { logger } from "../utils/logger.js";

let connected = false;

export async function connectToDatabase() {
  if (connected) {
    return;
  }

  const runtimeManifest = loadRuntimeManifest();
  await mongoose.connect(runtimeManifest.database.uri);
  connected = true;

  try {
    const db = mongoose.connection.db;
    if (db) {
      const migrations = db.collection("migrations");
      const migrationName = "cleanup_gmailMessageId_v1";
      const already = await migrations.findOne({ _id: migrationName } as never);
      if (!already) {
        const col = db.collection("invoices");
        const cleanResult = await col.updateMany(
          { gmailMessageId: null },
          { $unset: { gmailMessageId: "" } }
        );
        if (cleanResult.modifiedCount > 0) {
          logger.info("db.migration.gmailMessageId.cleanup", { modified: cleanResult.modifiedCount });
        }
        try {
          await col.dropIndex("tenantId_1_gmailMessageId_1");
          logger.info("db.migration.gmailMessageId.index.dropped");
        } catch {
        }
        await mongoose.model("Invoice").syncIndexes();
        await migrations.insertOne({ _id: migrationName, appliedAt: new Date() } as never);
        logger.info("db.migration.recorded", { name: migrationName });
      }
    }
  } catch (err) {
    logger.warn("db.migration.gmailMessageId.failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function disconnectFromDatabase() {
  if (!connected) {
    return;
  }
  await mongoose.disconnect();
  connected = false;
}
