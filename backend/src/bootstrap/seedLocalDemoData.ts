import { Types } from "mongoose";
import { TenantModel } from "@/models/core/Tenant.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { UserModel } from "@/models/core/User.js";
import { logger } from "@/utils/logger.js";
import { loadLocalDemoUsersConfig } from "@/config/localDemoUsers.js";
import type { KeycloakAdminClient } from "@/keycloak/KeycloakAdminClient.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { seedTdsRates } from "@/bootstrap/seedTdsRates.js";
import { getRoleDefaults } from "@/auth/personaDefaults.js";
import { seedDefaultGlCodes } from "@/services/compliance/seedGlCodes.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { seedDemoTenantConfig } from "@/bootstrap/seedDemoTenantConfig.js";
import { seedDemoInvoices } from "@/bootstrap/seedDemoInvoices.js";
import { env } from "@/config/env.js";

interface SeedLocalDemoDataOptions {
  fileStore?: FileStore;
}

export const DEMO_CLIENT_ORG_GSTIN = "36AAKCG4810D1ZV";
const DEMO_CLIENT_ORG_NAME = "Global Innovation Hub Private Limited";
const DEMO_CLIENT_ORG_STATE = "Telangana";

export async function seedDemoClientOrganization(
  tenantId: string
): Promise<Types.ObjectId> {
  const doc = await ClientOrganizationModel.findOneAndUpdate(
    { tenantId, gstin: DEMO_CLIENT_ORG_GSTIN },
    {
      $setOnInsert: {
        tenantId,
        gstin: DEMO_CLIENT_ORG_GSTIN,
        companyName: DEMO_CLIENT_ORG_NAME,
        stateName: DEMO_CLIENT_ORG_STATE,
        companyGuid: null,
        f12OverwriteByGuidVerified: false,
        detectedVersion: null
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  if (!doc) {
    throw new Error("seedDemoClientOrganization: upsert returned no document");
  }
  return doc._id as Types.ObjectId;
}

export async function seedLocalDemoData(
  keycloakAdmin: KeycloakAdminClient,
  options: SeedLocalDemoDataOptions = {}
): Promise<void> {
  const config = loadLocalDemoUsersConfig();
  logger.info("local.demo.seed.start");

  for (const tenant of config.tenants) {
    await TenantModel.findOneAndUpdate(
      { _id: tenantObjectId(tenant.id) },
      {
        _id: tenantObjectId(tenant.id),
        name: tenant.name,
        onboardingStatus: tenant.onboardingStatus,
        mode: tenant.mode ?? "test",
        enabled: true
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  for (const user of config.users) {
    const resolvedUser = await UserModel.findOneAndUpdate(
      { email: user.email },
      {
        email: user.email,
        externalSubject: `local-${user.email}`,
        tenantId: user.tenantId,
        displayName: user.displayName,
        lastLoginAt: new Date(0),
        encryptedRefreshToken: "",
        enabled: true
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (!resolvedUser) {
      throw new Error(`Failed to upsert local demo user '${user.email}'.`);
    }

    const capabilities = getRoleDefaults(user.role);

    await TenantUserRoleModel.findOneAndUpdate(
      {
        tenantId: user.tenantId,
        userId: String(resolvedUser._id)
      },
      {
        tenantId: user.tenantId,
        userId: String(resolvedUser._id),
        role: user.role,
        capabilities
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    try {
      const existing = await keycloakAdmin.findUserByEmail(user.email);
      if (!existing) {
        await keycloakAdmin.createUser(user.email, user.password, false);
      } else {
        await keycloakAdmin.setPassword(existing.id, user.password, false);
      }
    } catch (kcError) {
      logger.warn("local.demo.seed.keycloak.warn", {
        email: user.email,
        error: kcError instanceof Error ? kcError.message : String(kcError)
      });
    }
  }

  await seedTdsRates();

  for (const tenant of config.tenants) {
    const clientOrgs = await ClientOrganizationModel.find(
      { tenantId: tenant.id },
      { _id: 1 }
    ).lean();
    for (const clientOrg of clientOrgs) {
      await seedDefaultGlCodes(tenant.id, clientOrg._id);
    }
  }

  const DEMO_TENANT_ID = "65f0000000000000000000c3";
  const demoTenant = config.tenants.find((t) => t.id === DEMO_TENANT_ID);
  if (demoTenant) {
    const mahirUser = await UserModel.findOne({ email: "mahir.n@globalhealthx.co" }).lean();
    if (mahirUser) {
      const demoClientOrgId = await seedDemoClientOrganization(DEMO_TENANT_ID);
      await seedDefaultGlCodes(DEMO_TENANT_ID, demoClientOrgId);
      await seedDemoTenantConfig(DEMO_TENANT_ID, demoClientOrgId, String(mahirUser._id));
      if (env.LOCAL_DEMO_INVOICES) {
        await seedDemoInvoices(DEMO_TENANT_ID, demoClientOrgId, { fileStore: options.fileStore });
      }
    }
  }

  logger.info("local.demo.seed.complete", {
    tenants: config.tenants.length,
    users: config.users.length
  });
}

function tenantObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
