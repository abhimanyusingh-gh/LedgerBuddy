import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel, type TenantRole } from "../models/TenantUserRole.js";
import { UserModel } from "../models/User.js";
import { HttpError } from "../errors/HttpError.js";

export class TenantAdminService {
  async completeOnboarding(input: {
    tenantId: string;
    tenantName: string;
    adminEmail: string;
  }): Promise<void> {
    const tenant = await TenantModel.findById(input.tenantId);
    if (!tenant) {
      throw new HttpError("Tenant not found.", 404, "tenant_missing");
    }
    if (tenant.onboardingStatus === "completed") {
      throw new HttpError("Tenant onboarding is already completed.", 409, "tenant_onboarding_completed");
    }

    const normalizedName = input.tenantName.trim();
    if (!normalizedName) {
      throw new HttpError("Tenant name is required.", 400, "tenant_name_required");
    }
    tenant.name = normalizedName;
    tenant.onboardingStatus = "completed";
    await tenant.save();

    const normalizedAdminEmail = input.adminEmail.trim().toLowerCase();
    if (normalizedAdminEmail.length > 0) {
      await UserModel.updateMany(
        {
          tenantId: input.tenantId,
          email: normalizedAdminEmail
        },
        {
          $set: {
            email: normalizedAdminEmail
          }
        }
      );
    }
  }

  async listTenantUsers(tenantId: string): Promise<Array<{ userId: string; email: string; role: TenantRole }>> {
    const roleRecords = await TenantUserRoleModel.find({ tenantId }).lean();
    if (roleRecords.length === 0) {
      return [];
    }
    const users = await UserModel.find({
      _id: { $in: roleRecords.map((roleRecord) => roleRecord.userId) }
    }).lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));

    return roleRecords
      .map((roleRecord) => {
        const user = userMap.get(roleRecord.userId);
        if (!user) {
          return null;
        }
        return {
          userId: String(user._id),
          email: user.email,
          role: roleRecord.role
        };
      })
      .filter((value): value is { userId: string; email: string; role: TenantRole } => value !== null);
  }

  async assignRole(input: { tenantId: string; userId: string; role: TenantRole }): Promise<void> {
    await TenantUserRoleModel.findOneAndUpdate(
      {
        tenantId: input.tenantId,
        userId: input.userId
      },
      {
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );
  }

  async removeUser(input: { tenantId: string; userId: string }): Promise<void> {
    const roleRecord = await TenantUserRoleModel.findOne({
      tenantId: input.tenantId,
      userId: input.userId
    });
    if (!roleRecord) {
      return;
    }

    if (roleRecord.role === "TENANT_ADMIN") {
      const adminCount = await TenantUserRoleModel.countDocuments({
        tenantId: input.tenantId,
        role: "TENANT_ADMIN"
      });
      if (adminCount <= 1) {
        throw new HttpError("Tenant must keep at least one TENANT_ADMIN.", 409, "tenant_admin_required");
      }
    }

    await TenantUserRoleModel.deleteOne({ _id: roleRecord._id });
  }
}
