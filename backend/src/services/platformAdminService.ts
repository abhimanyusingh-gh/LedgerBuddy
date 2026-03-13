import { createHash, randomBytes } from "node:crypto";
import { InvoiceModel } from "../models/Invoice.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { TenantModel } from "../models/Tenant.js";
import { UserModel } from "../models/User.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import { HttpError } from "../errors/HttpError.js";
import type { InviteEmailSenderBoundary } from "../core/boundaries/InviteEmailSenderBoundary.js";
import { env } from "../config/env.js";

interface TenantUsageOverview {
  tenantId: string;
  tenantName: string;
  onboardingStatus: "pending" | "completed";
  userCount: number;
  totalDocuments: number;
  parsedDocuments: number;
  approvedDocuments: number;
  exportedDocuments: number;
  needsReviewDocuments: number;
  failedDocuments: number;
  gmailConnectionState: "CONNECTED" | "NEEDS_REAUTH" | "DISCONNECTED";
  adminTempPassword?: string;
  adminEmail?: string;
  lastIngestedAt: string | null;
  createdAt: string;
}

export class PlatformAdminService {
  private readonly emailSender?: InviteEmailSenderBoundary;

  constructor(emailSender?: InviteEmailSenderBoundary) {
    this.emailSender = emailSender;
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
    const passwordHash = createHash("sha256").update(tempPassword).digest("base64url");

    const tenant = await TenantModel.create({
      name: tenantName,
      onboardingStatus: "pending",
      ...(input.mode ? { mode: input.mode } : {})
    });

    const verificationToken = randomBytes(32).toString("base64url");
    const verificationTokenHash = createHash("sha256").update(verificationToken).digest("base64url");

    const createdUser = await UserModel.create({
      email: adminEmail,
      externalSubject: buildProvisionedSubject(adminEmail),
      tenantId: String(tenant._id),
      displayName,
      encryptedRefreshToken: "",
      lastLoginAt: new Date(0),
      passwordHash,
      tempPassword,
      mustChangePassword: true,
      verificationTokenHash
    });
    await TenantUserRoleModel.create({
      tenantId: String(tenant._id),
      userId: String(createdUser._id),
      role: "TENANT_ADMIN"
    });

    if (this.emailSender) {
      const verifyUrl = `${env.INVITE_BASE_URL}/auth/verify-email?token=${verificationToken}`;
      await this.emailSender.send({
        from: env.INVITE_FROM,
        to: adminEmail,
        subject: "Welcome to BillForge — Verify Your Email",
        text: `Welcome to BillForge!\n\nYour account has been created. Please verify your email to get started.\n\nVerify Email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
        html: buildVerificationEmailHtml(verifyUrl)
      });
    }

    return {
      tenantId: String(tenant._id),
      tenantName: tenant.name,
      adminUserId: String(createdUser._id),
      adminEmail: createdUser.email,
      tempPassword
    };
  }

  async listTenantUsageOverview(): Promise<TenantUsageOverview[]> {
    const [tenants, invoiceStats, userStats, integrations] = await Promise.all([
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
            lastIngestedAt: { $max: "$createdAt" }
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
      TenantIntegrationModel.find({ provider: "gmail" }).lean()
    ]);

    const invoiceMap = new Map(invoiceStats.map((entry) => [entry._id, entry]));
    const userMap = new Map(userStats.map((entry) => [entry._id, entry.userCount]));
    const gmailMap = new Map(
      integrations
        .filter((entry) => typeof entry.tenantId === "string" && entry.tenantId.trim().length > 0)
        .map((entry) => [entry.tenantId, entry.status])
    );

    const adminRoles = await TenantUserRoleModel.find({ role: "TENANT_ADMIN" }).lean();
    const adminUserIds = adminRoles.map((r) => r.userId);
    const adminUsers = await UserModel.find({ _id: { $in: adminUserIds } }).select({ tenantId: 1, tempPassword: 1, email: 1 }).lean();
    const tempPasswordMap = new Map<string, string>();
    const adminEmailMap = new Map<string, string>();
    for (const user of adminUsers) {
      if (user.tempPassword && typeof user.tempPassword === "string") {
        tempPasswordMap.set(user.tenantId, user.tempPassword);
      }
      if (user.email && typeof user.email === "string") {
        adminEmailMap.set(user.tenantId, user.email);
      }
    }

    return tenants.map((tenant) => {
      const tenantId = String(tenant._id);
      const invoice = invoiceMap.get(tenantId);
      const gmailStatus = gmailMap.get(tenantId);
      return {
        tenantId,
        tenantName: tenant.name,
        onboardingStatus: tenant.onboardingStatus,
        userCount: userMap.get(tenantId) ?? 0,
        totalDocuments: invoice?.totalDocuments ?? 0,
        parsedDocuments: invoice?.parsedDocuments ?? 0,
        approvedDocuments: invoice?.approvedDocuments ?? 0,
        exportedDocuments: invoice?.exportedDocuments ?? 0,
        needsReviewDocuments: invoice?.needsReviewDocuments ?? 0,
        failedDocuments: invoice?.failedDocuments ?? 0,
        gmailConnectionState:
          gmailStatus === "connected" ? "CONNECTED" : gmailStatus === "requires_reauth" ? "NEEDS_REAUTH" : "DISCONNECTED",
        lastIngestedAt: invoice?.lastIngestedAt ? new Date(invoice.lastIngestedAt).toISOString() : null,
        createdAt: new Date(tenant.createdAt).toISOString(),
        adminTempPassword: tempPasswordMap.get(tenantId),
        adminEmail: adminEmailMap.get(tenantId)
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

function buildVerificationEmailHtml(verifyUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background:#f5f5f5">
  <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:8px;overflow:hidden">
    <div style="background:#1a1a2e;padding:24px 32px">
      <h1 style="color:#fff;margin:0;font-size:22px">BillForge</h1>
    </div>
    <div style="padding:32px">
      <h2 style="margin:0 0 16px;color:#1a1a2e">Welcome to BillForge</h2>
      <p style="color:#333;line-height:1.6">Your account has been created. Please verify your email to get started.</p>
      <div style="text-align:center;margin:28px 0">
        <a href="${verifyUrl}" style="display:inline-block;background:#1f7a6c;color:#fff;padding:14px 32px;border-radius:6px;text-decoration:none;font-weight:bold">Verify Email</a>
      </div>
      <p style="color:#888;font-size:13px">This link expires in 24 hours.</p>
    </div>
  </div>
</body>
</html>`;
}
