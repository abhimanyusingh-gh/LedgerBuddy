import { connectToDatabase, disconnectFromDatabase } from "@/db/connect.js";
import { logger } from "@/utils/logger.js";
import { TenantModel } from "@/models/core/Tenant.js";
import { UserModel } from "@/models/core/User.js";
import { seedDemoTenantConfig } from "@/bootstrap/seedDemoTenantConfig.js";

const DEMO_TENANT_ID = "65f0000000000000000000c3";
const DEMO_TENANT_NAME = "Neelam and Associates";
const MAHIR_EMAIL = "mahir.n@globalhealthx.co";

async function run() {
  await connectToDatabase();

  const tenant = await TenantModel.findById(DEMO_TENANT_ID).lean();
  if (!tenant) {
    throw new Error(
      `Demo tenant '${DEMO_TENANT_NAME}' (${DEMO_TENANT_ID}) not found. ` +
        "Bring up the local stack with LOCAL_DEMO_SEED=true so core seed runs first."
    );
  }

  const mahirUser = await UserModel.findOne({ email: MAHIR_EMAIL }).lean();
  if (!mahirUser) {
    throw new Error(
      `Demo tenant owner '${MAHIR_EMAIL}' not found. Run the local demo seed before seeding config.`
    );
  }

  await seedDemoTenantConfig(DEMO_TENANT_ID, String(mahirUser._id));

  logger.info("seedDemoTenant.complete", { tenantId: DEMO_TENANT_ID });
  console.log(`Demo tenant config seeded successfully for ${DEMO_TENANT_NAME} (${DEMO_TENANT_ID}).`);
}

run()
  .then(async () => {
    await disconnectFromDatabase();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("seedDemoTenant failed:", error instanceof Error ? error.message : String(error));
    try {
      await disconnectFromDatabase();
    } catch {
      // swallow — already erroring
    }
    process.exit(1);
  });
