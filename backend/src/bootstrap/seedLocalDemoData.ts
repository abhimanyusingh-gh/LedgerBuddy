import { Types } from "mongoose";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import { UserModel } from "../models/User.js";
import { logger } from "../utils/logger.js";
import { loadLocalDemoUsersConfig } from "../config/localDemoUsers.js";

export async function seedLocalDemoData(): Promise<void> {
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

    await TenantUserRoleModel.findOneAndUpdate(
      {
        tenantId: user.tenantId,
        userId: String(resolvedUser._id)
      },
      {
        tenantId: user.tenantId,
        userId: String(resolvedUser._id),
        role: user.role
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }

  logger.info("local.demo.seed.complete", {
    tenants: config.tenants.length,
    users: config.users.length
  });
}

function tenantObjectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}
