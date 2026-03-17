import { connectToDatabase } from "../db/connect.js";
import { logger } from "../utils/logger.js";
import { env } from "../config/env.js";
import { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";
import { TenantModel } from "../models/Tenant.js";
import { UserModel } from "../models/User.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";

async function run() {
  const email = env.platformAdminEmails[0];
  const password = env.PLATFORM_ADMIN_SEED_PASSWORD;

  if (!email) {
    console.error("PLATFORM_ADMIN_EMAILS is not set. Set it to the platform admin email address.");
    process.exit(1);
  }

  if (!password) {
    console.error(
      "PLATFORM_ADMIN_SEED_PASSWORD is not set. Set it to bootstrap the platform admin password.\n" +
        "Example: PLATFORM_ADMIN_SEED_PASSWORD=TempAdminPass!1 yarn seed:platform-admin"
    );
    process.exit(1);
  }

  await connectToDatabase();

  const keycloakAdmin = new KeycloakAdminClient(
    env.keycloakInternalBaseUrl,
    env.keycloakRealm,
    env.STS_CLIENT_ID,
    env.STS_CLIENT_SECRET
  );

  // Keycloak: create user if not already present (idempotent)
  const exists = await keycloakAdmin.userExists(email);
  if (!exists) {
    await keycloakAdmin.createUser(email, password, false);
    logger.info("seedPlatformAdmin.keycloak.created", { email });
  } else {
    logger.info("seedPlatformAdmin.keycloak.exists", { email });
  }

  // MongoDB: upsert Platform tenant
  const tenant = await TenantModel.findOneAndUpdate(
    { name: "Platform" },
    { name: "Platform", onboardingStatus: "completed", enabled: true },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const tenantId = String(tenant!._id);

  // MongoDB: upsert User
  const user = await UserModel.findOneAndUpdate(
    { email },
    {
      email,
      externalSubject: email,
      tenantId,
      displayName: "Platform Admin",
      enabled: true,
      encryptedRefreshToken: "",
      lastLoginAt: new Date(0)
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  const userId = String(user!._id);

  // MongoDB: upsert TenantUserRole
  await TenantUserRoleModel.findOneAndUpdate(
    { tenantId, userId },
    { tenantId, userId, role: "PLATFORM_ADMIN" },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  logger.info("seedPlatformAdmin.complete", { email, tenantId, userId });
  console.log(`Platform admin seeded successfully: ${email}`);
  process.exit(0);
}

run().catch((error) => {
  console.error("seedPlatformAdmin failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
