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
        // index may not exist or already be the correct type
      }
      await mongoose.model("Invoice").syncIndexes();
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
