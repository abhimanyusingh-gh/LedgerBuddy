import { createHash, randomBytes } from "node:crypto";
import { env } from "@/config/env.js";
import type { InviteEmailSenderBoundary } from "@/core/boundaries/InviteEmailSenderBoundary.js";
import { TenantInviteModel } from "@/models/integration/TenantInvite.js";
import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { UserModel } from "@/models/core/User.js";
import { HttpError } from "@/errors/HttpError.js";
import type { KeycloakAdminClient } from "@/keycloak/KeycloakAdminClient.js";

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

export class TenantInviteService {
  constructor(
    private readonly inviteEmailSender: InviteEmailSenderBoundary,
    private readonly keycloakAdmin: KeycloakAdminClient
  ) {}

  async createInvite(input: {
    tenantId: string;
    invitedByUserId: string;
    email: string;
  }): Promise<{ inviteId: string; expiresAt: string }> {
    const normalizedEmail = normalizeEmail(input.email);
    if (!normalizedEmail) {
      throw new HttpError("Invite email is invalid.", 400, "invite_email_invalid");
    }

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invite = await TenantInviteModel.findOneAndUpdate(
      {
        tenantId: input.tenantId,
        email: normalizedEmail,
        acceptedAt: { $exists: false }
      },
      {
        tenantId: input.tenantId,
        email: normalizedEmail,
        tokenHash,
        invitedByUserId: input.invitedByUserId,
        role: "ap_clerk",
        expiresAt,
        acceptedAt: undefined
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    await this.sendInviteEmail({
      email: normalizedEmail,
      token,
      expiresAt
    });

    // Register in Keycloak if not already present; send password setup email
    const alreadyExists = await this.keycloakAdmin.userExists(normalizedEmail);
    if (!alreadyExists) {
      const kcUserId = await this.keycloakAdmin.createUser(normalizedEmail, "", false);
      try {
        await this.keycloakAdmin.executeActionsEmail(kcUserId, ["UPDATE_PASSWORD"]);
      } catch {
        // Non-critical: KC SMTP may not be configured in local dev
      }
    }

    return {
      inviteId: String(invite._id),
      expiresAt: expiresAt.toISOString()
    };
  }

  async acceptInvite(input: { token: string; userId: string }): Promise<void> {
    const tokenHash = hashToken(input.token);
    const invite = await TenantInviteModel.findOne({ tokenHash });
    if (!invite) {
      throw new HttpError("Invite token is invalid.", 400, "invite_token_invalid");
    }
    if (invite.acceptedAt) {
      throw new HttpError("Invite token is already used.", 409, "invite_token_used");
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      throw new HttpError("Invite token has expired.", 410, "invite_token_expired");
    }

    const user = await UserModel.findById(input.userId);
    if (!user) {
      throw new HttpError("Authenticated user not found.", 401, "auth_user_missing");
    }

    user.tenantId = invite.tenantId;
    await user.save();

    await TenantUserRoleModel.findOneAndUpdate(
      {
        tenantId: invite.tenantId,
        userId: String(user._id)
      },
      {
        tenantId: invite.tenantId,
        userId: String(user._id),
        role: "ap_clerk"
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true
      }
    );

    invite.acceptedAt = new Date();
    await invite.save();
  }

  private async sendInviteEmail(input: { email: string; token: string; expiresAt: Date }): Promise<void> {
    const inviteUrl = `${env.INVITE_BASE_URL.replace(/\/+$/, "")}/invite?token=${encodeURIComponent(input.token)}`;
    const expiresAt = input.expiresAt.toISOString();
    const textBody = [
      "You were invited to join a tenant in BillForge.",
      "",
      `Accept invite: ${inviteUrl}`,
      `Expires at: ${expiresAt}`
    ].join("\n");
    const htmlBody = [
      "<p>You were invited to join a tenant in BillForge.</p>",
      `<p><strong>Accept invite:</strong> <a href="${inviteUrl}">${inviteUrl}</a></p>`,
      `<p><strong>Expires at:</strong> ${expiresAt}</p>`
    ].join("");

    await this.inviteEmailSender.send({
      from: env.INVITE_FROM,
      to: input.email,
      subject: "You were invited to BillForge",
      text: textBody,
      html: htmlBody
    });
  }
}

function normalizeEmail(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!normalized.includes("@")) {
    return "";
  }
  return normalized;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
