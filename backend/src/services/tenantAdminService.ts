import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel, type TenantRole } from "../models/TenantUserRole.js";
import { UserModel } from "../models/User.js";
import { HttpError } from "../errors/HttpError.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { TenantMailboxAssignmentModel } from "../models/TenantMailboxAssignment.js";
import { ViewerScopeModel } from "../models/ViewerScope.js";
import { Types } from "mongoose";

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

  async setUserEnabled(input: { tenantId: string; userId: string; enabled: boolean }): Promise<void> {
    const user = await UserModel.findOne({ _id: input.userId, tenantId: input.tenantId });
    if (!user) {
      throw new HttpError("User not found.", 404, "tenant_user_not_found");
    }
    await UserModel.updateOne({ _id: input.userId }, { $set: { enabled: input.enabled } });
  }

  async listTenantUsers(tenantId: string): Promise<Array<{ userId: string; email: string; role: TenantRole; enabled: boolean }>> {
    const roleRecords = await TenantUserRoleModel.find({ tenantId }).lean();
    if (roleRecords.length === 0) {
      return [];
    }
    const users = await UserModel.find({
      _id: { $in: roleRecords.map((roleRecord) => roleRecord.userId) }
    }).lean();
    const userMap = new Map(users.map((user) => [String(user._id), user]));

    return roleRecords
      .filter((roleRecord) => roleRecord.role !== "PLATFORM_ADMIN")
      .map((roleRecord) => {
        const user = userMap.get(roleRecord.userId);
        if (!user) {
          return null;
        }
        return {
          userId: String(user._id),
          email: user.email,
          role: roleRecord.role as TenantRole,
          enabled: user.enabled !== false
        };
      })
      .filter((value): value is NonNullable<typeof value> => value !== null);
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

  async listMailboxes(tenantId: string) {
    const integrations = await TenantIntegrationModel.find({ tenantId }).lean();
    const integrationIds = integrations.map((i) => i._id);
    const assignments = await TenantMailboxAssignmentModel.find({ tenantId, integrationId: { $in: integrationIds } }).lean();
    const users = await this.listTenantUsers(tenantId);
    const userMap = new Map(users.map((u) => [u.userId, u.email]));

    return integrations.map((integration) => {
      const iid = (integration._id as Types.ObjectId).toString();
      const integrationAssignments = assignments.filter((a) => a.integrationId.toString() === iid);
      const hasAll = integrationAssignments.some((a) => a.assignedTo === "all");
      const specificAssignments = integrationAssignments
        .filter((a) => a.assignedTo !== "all")
        .map((a) => ({ userId: a.assignedTo, email: userMap.get(a.assignedTo) ?? a.assignedTo }));

      return {
        _id: iid,
        provider: integration.provider,
        emailAddress: integration.emailAddress,
        status: integration.status,
        lastSyncedAt: integration.lastSyncedAt,
        assignments: hasAll ? ("all" as const) : specificAssignments
      };
    });
  }

  async assignMailbox(tenantId: string, integrationId: string, userId: string): Promise<void> {
    const oid = new Types.ObjectId(integrationId);
    const integration = await TenantIntegrationModel.findOne({ _id: oid, tenantId }).lean();
    if (!integration) {
      throw new HttpError("Mailbox not found.", 404, "mailbox_not_found");
    }
    await TenantMailboxAssignmentModel.updateOne(
      { tenantId, integrationId: oid, assignedTo: userId },
      { tenantId, integrationId: oid, assignedTo: userId },
      { upsert: true }
    );
  }

  async removeMailboxAssignment(tenantId: string, integrationId: string, userId: string): Promise<void> {
    const oid = new Types.ObjectId(integrationId);
    await TenantMailboxAssignmentModel.deleteOne({ tenantId, integrationId: oid, assignedTo: userId });
  }

  async deleteMailbox(tenantId: string, integrationId: string): Promise<void> {
    const oid = new Types.ObjectId(integrationId);
    const integration = await TenantIntegrationModel.findOne({ _id: oid, tenantId }).lean();
    if (!integration) {
      throw new HttpError("Mailbox not found.", 404, "mailbox_not_found");
    }
    await TenantMailboxAssignmentModel.deleteMany({ tenantId, integrationId: oid });
    await TenantIntegrationModel.deleteOne({ _id: oid, tenantId });
  }

  async getViewerScope(tenantId: string, viewerUserId: string) {
    const scope = await ViewerScopeModel.findOne({ tenantId, viewerUserId }).lean();
    return { visibleUserIds: scope?.visibleUserIds ?? [] };
  }

  async setViewerScope(tenantId: string, viewerUserId: string, visibleUserIds: string[]): Promise<{ visibleUserIds: string[] }> {
    await ViewerScopeModel.findOneAndUpdate(
      { tenantId, viewerUserId },
      { $set: { visibleUserIds } },
      { upsert: true }
    );
    return { visibleUserIds };
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
