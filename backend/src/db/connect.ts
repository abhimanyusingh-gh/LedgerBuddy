import mongoose from "mongoose";
import { loadRuntimeManifest } from "@/core/runtimeManifest.js";
import { logger } from "@/utils/logger.js";
import { seedDefaultGlCodes } from "@/services/compliance/seedGlCodes.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { findClientOrgIdsForTenant } from "@/services/auth/tenantScope.js";
import { applyMinorFieldValidators } from "@/db/applyJsonSchemaValidators.js";
import { ValidationAction, ValidationLevel } from "@/db/applyJsonSchemaValidators.js";
import "@/models/invoice/Invoice.js";
import "@/models/bank/BankAccount.js";
import "@/models/bank/BankTransaction.js";
import "@/models/core/TenantUserRole.js";
import "@/models/integration/ClientComplianceConfig.js";
import "@/models/compliance/TdsRateTable.js";

const MINOR_FIELD_VALIDATOR_MIGRATION = "minor_field_jsonschema_validators_v1";

interface ConnectOptions {
  skipBootstrap?: boolean;
}

let connectionPromise: Promise<void> | null = null;

export async function connectToDatabase(options: ConnectOptions = {}) {
  if (connectionPromise) return connectionPromise;
  connectionPromise = doConnect(options);
  return connectionPromise;
}

async function doConnect(options: ConnectOptions) {
  const runtimeManifest = loadRuntimeManifest();
  await mongoose.connect(runtimeManifest.database.uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
  });

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

  try {
    const db = mongoose.connection.db;
    if (db) {
      const migrations = db.collection("migrations");
      const glMigrationName = "seed_default_gl_codes_v1";
      const alreadyRan = await migrations.findOne({ _id: glMigrationName } as never);
      if (!alreadyRan) {
        const tenants = await TenantModel.find({}, { _id: 1 }).lean();
        let totalCreated = 0;
        let totalSkipped = 0;
        for (const tenant of tenants) {
          const tenantId = String(tenant._id);
          const clientOrgIds = await findClientOrgIdsForTenant(tenantId);
          for (const clientOrgId of clientOrgIds) {
            const existingCount = await GlCodeMasterModel.countDocuments({
              tenantId,
              clientOrgId
            });
            if (existingCount === 0) {
              const result = await seedDefaultGlCodes(tenantId, clientOrgId);
              totalCreated += result.created;
              totalSkipped += result.skipped;
            }
          }
        }
        if (totalCreated > 0) {
          logger.info("db.migration.glCodes.seeded", { totalCreated, totalSkipped, tenants: tenants.length });
        }
        await migrations.insertOne({ _id: glMigrationName, appliedAt: new Date() } as never);
        logger.info("db.migration.recorded", { name: glMigrationName });
      }
    }
  } catch (err) {
    logger.warn("db.migration.glCodes.failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  if (options.skipBootstrap) return;

  try {
    const db = mongoose.connection.db;
    if (!db) return;

    const migrations = db.collection("migrations");
    const alreadyApplied = await migrations.findOne({ _id: MINOR_FIELD_VALIDATOR_MIGRATION } as never);
    if (alreadyApplied) return;

    const results = await applyMinorFieldValidators(db, {
      action: ValidationAction.Warn,
      level: ValidationLevel.Strict,
      log: (event, details) => logger.info(event, details)
    });

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      logger.warn("db.migration.minorValidators.partial", {
        failed: failed.map((r) => ({ modelName: r.modelName, error: r.errorMessage }))
      });
    }

    await migrations.updateOne(
      { _id: MINOR_FIELD_VALIDATOR_MIGRATION } as never,
      {
        $setOnInsert: {
          _id: MINOR_FIELD_VALIDATOR_MIGRATION,
          appliedAt: new Date(),
          action: ValidationAction.Warn,
          level: ValidationLevel.Strict,
          source: "bootstrap"
        }
      } as never,
      { upsert: true }
    );
    logger.info("db.migration.recorded", { name: MINOR_FIELD_VALIDATOR_MIGRATION });
  } catch (err) {
    logger.warn("db.migration.minorValidators.failed", {
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

export async function disconnectFromDatabase() {
  if (!connectionPromise) {
    return;
  }
  await mongoose.disconnect();
  connectionPromise = null;
}
