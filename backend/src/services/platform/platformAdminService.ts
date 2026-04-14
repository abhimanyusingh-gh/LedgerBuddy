import { randomBytes, scryptSync } from "node:crypto";
import { InvoiceModel } from "../models/Invoice.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { TenantModel } from "../models/Tenant.js";
import { UserModel } from "../models/User.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import { HttpError } from "../errors/HttpError.js";
import type { InviteEmailSenderBoundary } from "../core/boundaries/InviteEmailSenderBoundary.js";
import type { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";
import { seedDefaultGlCodes } from "./seedGlCodes.js";

interface TenantUsageOverview {
  tenantId: string;
  tenantName: string;
  enabled: boolean;
  onboardingStatus: "pending" | "completed";
  userCount: number;
  totalDocuments: number;
  parsedDocuments: number;
  approvedDocuments: number;
  exportedDocuments: number;
  needsReviewDocuments: number;
  failedDocuments: number;
  gmailConnectionState: "CONNECTED" | "NEEDS_REAUTH" | "DISCONNECTED";
  adminEmail?: string;
  ocrTokensTotal: number;
  slmTokensTotal: number;
  lastIngestedAt: string | null;
  createdAt: string;
}

export class PlatformAdminService {
  private readonly emailSender?: InviteEmailSenderBoundary;
  private readonly keycloakAdmin: KeycloakAdminClient;

  constructor(emailSender?: InviteEmailSenderBoundary, keycloakAdmin?: KeycloakAdminClient) {
    this.emailSender = emailSender;
    this.keycloakAdmin = keycloakAdmin!;
  }

  async onboardTenantAdmin(input: { tenantName: string; adminEmail: string; displayName?: string; mode?: "test" | "live" }): Promise<{
    tenantId: string;
    tenantName: string;
    adminUserId: string;
    adminEmail: string;
    tempPassword: string;
  }> {
    const tenantName = input.tenantName.trim();
    const adminEmail = input.adminEmail.trim().toLowerCase();
    const displayName = (input.displayName ?? "").trim() || deriveDisplayName(adminEmail);

    if (!tenantName) {
      throw new HttpError("Tenant name is required.", 400, "platform_tenant_name_required");
    }
    if (!adminEmail || !adminEmail.includes("@")) {
      throw new HttpError("Admin email is invalid.", 400, "platform_admin_email_invalid");
    }

    const existingUser = await UserModel.findOne({ email: adminEmail }).lean();
    if (existingUser) {
      throw new HttpError("Admin user already exists. Use tenant admin role assignment flow.", 409, "platform_admin_exists");
    }

    const tempPassword = randomBytes(6).toString("base64url");
    const salt = randomBytes(16).toString("hex");
    const hashedTempPassword = salt + ":" + scryptSync(tempPassword, salt, 64).toString("hex");

    const tenant = await TenantModel.create({
      name: tenantName,
      onboardingStatus: "pending",
      ...(input.mode ? { mode: input.mode } : {})
    });

    let createdUser;
    try {
      createdUser = await UserModel.create({
        email: adminEmail,
        externalSubject: buildProvisionedSubject(adminEmail),
        tenantId: String(tenant._id),
        displayName,
        encryptedRefreshToken: "",
        lastLoginAt: new Date(0),
        tempPassword: hashedTempPassword,
        mustChangePassword: true
      });
      await TenantUserRoleModel.create({
        tenantId: String(tenant._id),
        userId: String(createdUser._id),
        role: "TENANT_ADMIN"
      });
    } catch (dbError) {
      await TenantModel.deleteOne({ _id: tenant._id });
      throw dbError;
    }

    try {
      await this.keycloakAdmin.createUser(adminEmail, tempPassword, false);
    } catch (kcError) {
      await UserModel.deleteOne({ _id: createdUser._id });
      await TenantUserRoleModel.deleteOne({ tenantId: String(tenant._id), userId: String(createdUser._id) });
      await TenantModel.deleteOne({ _id: tenant._id });
      throw new HttpError("Failed to register user in identity provider.", 502, "platform_kc_create_failed");
    }

    await seedDefaultGlCodes(String(tenant._id));

    return {
      tenantId: String(tenant._id),
      tenantName: tenant.name,
      adminUserId: String(createdUser._id),
      adminEmail: createdUser.email,
      tempPassword
    };
  }

  async setTenantEnabled(tenantId: string, enabled: boolean): Promise<void> {
    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      throw new HttpError("Tenant not found.", 404, "platform_tenant_not_found");
    }
    await TenantModel.updateOne({ _id: tenantId }, { $set: { enabled } });
  }

  async listTenantUsageOverview(): Promise<TenantUsageOverview[]> {
    const [tenants, invoiceStats, userStats, integrations, adminInfoList] = await Promise.all([
      TenantModel.find().sort({ createdAt: 1 }).lean(),
      InvoiceModel.aggregate<{
        _id: string;
        totalDocuments: number;
        parsedDocuments: number;
        approvedDocuments: number;
        exportedDocuments: number;
        needsReviewDocuments: number;
        failedDocuments: number;
        lastIngestedAt: Date | null;
        ocrTokensTotal: number;
        slmTokensTotal: number;
      }>([
        {
          $group: {
            _id: "$tenantId",
            totalDocuments: { $sum: 1 },
            parsedDocuments: {
              $sum: {
                $cond: [{ $eq: ["$status", "PARSED"] }, 1, 0]
              }
            },
            approvedDocuments: {
              $sum: {
                $cond: [{ $eq: ["$status", "APPROVED"] }, 1, 0]
              }
            },
            exportedDocuments: {
              $sum: {
                $cond: [{ $eq: ["$status", "EXPORTED"] }, 1, 0]
              }
            },
            needsReviewDocuments: {
              $sum: {
                $cond: [{ $eq: ["$status", "NEEDS_REVIEW"] }, 1, 0]
              }
            },
            failedDocuments: {
              $sum: {
                $cond: [{ $in: ["$status", ["FAILED_OCR", "FAILED_PARSE"]] }, 1, 0]
              }
            },
            lastIngestedAt: { $max: "$createdAt" },
            ocrTokensTotal: { $sum: { $ifNull: ["$ocrTokens", 0] } },
            slmTokensTotal: { $sum: { $ifNull: ["$slmTokens", 0] } }
          }
        }
      ]),
      UserModel.aggregate<{ _id: string; userCount: number }>([
        {
          $group: {
            _id: "$tenantId",
            userCount: { $sum: 1 }
          }
        }
      ]),
      TenantIntegrationModel.find({ provider: "gmail" }).lean(),
      TenantUserRoleModel.aggregate<{ _id: string; email: string }>([
        { $match: { role: "TENANT_ADMIN" } },
        {
          $lookup: {
            from: "users",
            let: { uid: { $toObjectId: "$userId" } },
            pipeline: [{ $match: { $expr: { $eq: ["$_id", "$$uid"] } } }],
            as: "user"
          }
        },
        { $unwind: "$user" },
        { $group: { _id: "$tenantId", email: { $first: "$user.email" } } }
      ])
    ]);

    const invoiceMap = new Map(invoiceStats.map((entry) => [entry._id, entry]));
    const userMap = new Map(userStats.map((entry) => [entry._id, entry.userCount]));
    const gmailMap = new Map(
      integrations
        .filter((entry) => typeof entry.tenantId === "string" && entry.tenantId.trim().length > 0)
        .map((entry) => [entry.tenantId, entry.status])
    );

    const adminInfoMap = new Map(adminInfoList.map((a) => [a._id, a]));

    return tenants.map((tenant) => {
      const tenantId = String(tenant._id);
      const invoice = invoiceMap.get(tenantId);
      const gmailStatus = gmailMap.get(tenantId);
      return {
        tenantId,
        tenantName: tenant.name,
        enabled: tenant.enabled !== false,
        onboardingStatus: tenant.onboardingStatus,
        userCount: userMap.get(tenantId) ?? 0,
        totalDocuments: invoice?.totalDocuments ?? 0,
        parsedDocuments: invoice?.parsedDocuments ?? 0,
        approvedDocuments: invoice?.approvedDocuments ?? 0,
        exportedDocuments: invoice?.exportedDocuments ?? 0,
        needsReviewDocuments: invoice?.needsReviewDocuments ?? 0,
        failedDocuments: invoice?.failedDocuments ?? 0,
        ocrTokensTotal: invoice?.ocrTokensTotal ?? 0,
        slmTokensTotal: invoice?.slmTokensTotal ?? 0,
        gmailConnectionState:
          gmailStatus === "connected" ? "CONNECTED" : gmailStatus === "requires_reauth" ? "NEEDS_REAUTH" : "DISCONNECTED",
        lastIngestedAt: invoice?.lastIngestedAt ? new Date(invoice.lastIngestedAt).toISOString() : null,
        createdAt: new Date(tenant.createdAt).toISOString(),
        adminEmail: adminInfoMap.get(tenantId)?.email
      };
    });
  }
}

function deriveDisplayName(email: string): string {
  const left = email.split("@")[0] ?? "";
  const trimmed = left.trim();
  return trimmed.length > 0 ? trimmed : "Tenant Admin";
}

function buildProvisionedSubject(email: string): string {
  return `provisioned-${email.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()}`;
}

