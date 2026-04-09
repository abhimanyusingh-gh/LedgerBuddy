import { randomBytes, createHash } from "node:crypto";
import { AuthLoginStateModel } from "../models/AuthLoginState.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel, normalizeTenantRole } from "../models/TenantUserRole.js";
import { UserModel } from "../models/User.js";
import { env } from "../config/env.js";
import type { OidcProvider } from "../sts/OidcProvider.js";
import { createSessionToken, verifySessionToken } from "./sessionToken.js";
import { encryptSecret, decryptSecret } from "../utils/secretCrypto.js";
import type { AuthenticatedRequestContext, SessionFlagsPayload } from "../types/auth.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { HttpError } from "../errors/HttpError.js";
import type { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";
import { mergeCapabilitiesWithDefaults } from "./personaDefaults.js";

interface LoginCallbackResult {
  sessionToken: string;
  redirectPath: string;
  context: AuthenticatedRequestContext;
}

export class AuthService {
  constructor(
    private readonly oidc: OidcProvider,
    private readonly keycloakAdmin: KeycloakAdminClient
  ) {}

  async getAuthorizationUrl(options: { nextPath?: string; loginHint?: string } = {}): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(Date.now() + env.AUTH_STATE_TTL_SECONDS * 1000);
    const redirectUri = env.OIDC_REDIRECT_URI;
    const nextPath = options.nextPath ?? "/";
    const loginHint = options.loginHint?.trim().toLowerCase() ?? "";

    await AuthLoginStateModel.create({
      state,
      codeVerifier,
      redirectUri,
      nextPath: normalizeNextPath(nextPath),
      expiresAt
    });

    return this.oidc.getAuthorizationUrl({
      state,
      redirectUri,
      codeChallenge,
      loginHint: loginHint.length > 0 ? loginHint : undefined,
      scopes: env.OIDC_SCOPES.split(" ")
        .map((scope) => scope.trim())
        .filter(Boolean)
    });
  }

  async handleAuthorizationCallback(code: string, state: string): Promise<LoginCallbackResult> {
    const stateRecord = await AuthLoginStateModel.findOne({ state });
    if (!stateRecord) {
      throw new HttpError("OAuth state is invalid.", 400, "oauth_state_invalid");
    }
    if (stateRecord.expiresAt.getTime() <= Date.now()) {
      await AuthLoginStateModel.deleteOne({ _id: stateRecord._id });
      throw new HttpError("OAuth state has expired.", 400, "oauth_state_expired");
    }
    await AuthLoginStateModel.deleteOne({ _id: stateRecord._id });

    const tokenResult = await this.oidc.exchangeAuthorizationCode({
      code,
      redirectUri: stateRecord.redirectUri,
      codeVerifier: stateRecord.codeVerifier
    });
    const validated = await this.oidc.validateAccessToken({
      accessToken: tokenResult.accessToken
    });
    const claims = this.oidc.normalizeClaims(validated);
    const encryptedRefreshToken = encryptSecret(tokenResult.refreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET);

    const context = await this.upsertPrincipal({
      subject: claims.subject,
      email: claims.email,
      name: claims.name,
      encryptedRefreshToken
    });

    const sessionToken = this.createSessionTokenForContext(context);

    return {
      sessionToken,
      redirectPath: stateRecord.nextPath,
      context
    };
  }

  async loginWithPassword(email: string, password: string): Promise<{ sessionToken: string; context: AuthenticatedRequestContext }> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !password) {
      throw new HttpError("Email and password are required.", 400, "auth_credentials_missing");
    }

    const grant = await this.oidc.exchangePasswordGrant(normalizedEmail, password);
    if (!grant.ok) {
      throw new HttpError("Invalid email or password.", 401, "auth_credentials_invalid");
    }

    const validated = await this.oidc.validateAccessToken({ accessToken: grant.accessToken });
    const claims = this.oidc.normalizeClaims(validated);

    const encryptedRefreshToken = grant.refreshToken
      ? encryptSecret(grant.refreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET)
      : "";

    const context = await this.upsertPrincipal({
      subject: claims.subject,
      email: normalizedEmail,
      name: claims.name ?? normalizedEmail,
      encryptedRefreshToken
    });

    await UserModel.updateOne(
      { email: normalizedEmail },
      { $set: { lastLoginAt: new Date() } }
    );

    return {
      sessionToken: this.createSessionTokenForContext(context),
      context
    };
  }

  async changePassword(context: AuthenticatedRequestContext, currentPassword: string, newPassword: string): Promise<void> {
    const verify = await this.oidc.exchangePasswordGrant(context.email, currentPassword);
    if (!verify.ok) {
      throw new HttpError("Current password is incorrect.", 401, "auth_invalid_current_password");
    }

    const kcUser = await this.keycloakAdmin.findUserByEmail(context.email);
    if (!kcUser) {
      throw new HttpError("User not found in identity provider.", 500, "auth_kc_user_missing");
    }

    await this.keycloakAdmin.setPassword(kcUser.id, newPassword, false);

    await UserModel.updateOne(
      { email: context.email },
      { $set: { mustChangePassword: false }, $unset: { tempPassword: "" } }
    );
  }

  async refreshSession(sessionToken: string): Promise<{ sessionToken: string }> {
    let verified: ReturnType<typeof verifySessionToken>;
    try {
      verified = verifySessionToken(sessionToken, env.APP_SESSION_SIGNING_SECRET);
    } catch {
      throw new HttpError("Session token is invalid or expired.", 401, "auth_session_invalid");
    }

    const user = await UserModel.findById(verified.userId);
    if (!user || !user.encryptedRefreshToken) {
      throw new HttpError("Authenticated user not found or missing refresh token.", 401, "auth_user_missing");
    }

    let decryptedRefreshToken: string;
    try {
      decryptedRefreshToken = decryptSecret(user.encryptedRefreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET);
    } catch {
      throw new HttpError("Refresh token could not be decrypted.", 401, "auth_refresh_decrypt_failed");
    }

    let kcTokens: { accessToken: string; refreshToken: string };
    try {
      kcTokens = await this.oidc.refreshAccessToken(decryptedRefreshToken);
    } catch {
      throw new HttpError("Keycloak refresh token is invalid or expired.", 401, "auth_refresh_failed");
    }

    const newEncryptedRefreshToken = encryptSecret(kcTokens.refreshToken, env.REFRESH_TOKEN_ENCRYPTION_SECRET);
    user.encryptedRefreshToken = newEncryptedRefreshToken;
    await user.save();

    const [tenant, roleRecord] = await Promise.all([
      TenantModel.findById(user.tenantId).lean(),
      TenantUserRoleModel.findOne({ tenantId: user.tenantId, userId: String(user._id) }).lean()
    ]);
    if (!tenant) {
      throw new HttpError("Tenant not found.", 401, "auth_tenant_missing");
    }
    if (!roleRecord) {
      throw new HttpError("User role not found.", 401, "auth_role_missing");
    }

    const context = buildContext(user, tenant, roleRecord.role);
    return { sessionToken: this.createSessionTokenForContext(context) };
  }

  async resolveRequestContext(sessionToken: string): Promise<AuthenticatedRequestContext> {
    const verified = verifySessionToken(sessionToken, env.APP_SESSION_SIGNING_SECRET);
    const user = await UserModel.findById(verified.userId).lean();
    if (!user) {
      throw new HttpError("Authenticated user not found.", 401, "auth_user_missing");
    }
    if (String(user.tenantId) !== verified.tenantId) {
      throw new HttpError("Session tenant mismatch.", 401, "auth_tenant_mismatch");
    }
    const tenant = await TenantModel.findById(verified.tenantId).lean();
    if (!tenant) {
      throw new HttpError("Tenant not found.", 401, "auth_tenant_missing");
    }

    if (!verified.isPlatformAdmin) {
      if (user.enabled === false) {
        throw new HttpError("Your account has been disabled. Contact your tenant administrator.", 403, "user_disabled");
      }
      if (tenant.enabled === false) {
        throw new HttpError("This account has been disabled. Contact your administrator.", 403, "tenant_disabled");
      }
    }

    return {
      userId: String(user._id),
      email: user.email,
      tenantId: verified.tenantId,
      tenantName: tenant.name,
      onboardingStatus: tenant.onboardingStatus,
      role: normalizeTenantRole(verified.role),
      isPlatformAdmin: verified.isPlatformAdmin
    };
  }

  async getSessionFlags(context: AuthenticatedRequestContext): Promise<SessionFlagsPayload> {
    const [gmailIntegration, userDoc, roleDoc] = await Promise.all([
      TenantIntegrationModel.findOne({
        tenantId: context.tenantId,
        provider: "gmail"
      }).lean(),
      UserModel.findById(context.userId).select({ mustChangePassword: 1, emailVerified: 1 }).lean(),
      TenantUserRoleModel.findOne({ tenantId: context.tenantId, userId: context.userId }).lean()
    ]);
    const requiresReauth = gmailIntegration?.status === "requires_reauth";
    const rawRoleDoc = roleDoc as Record<string, unknown> | null;
    const roleForDefaults = typeof rawRoleDoc?.role === "string" ? rawRoleDoc.role : context.role;
    const capabilities = mergeCapabilitiesWithDefaults(
      roleForDefaults,
      rawRoleDoc?.capabilities as Record<string, unknown> | null | undefined
    );

    return {
      requires_tenant_setup: context.onboardingStatus !== "completed",
      requires_reauth: requiresReauth,
      requires_admin_action: requiresReauth && capabilities.canManageConnections === true,
      requires_email_confirmation: false,
      must_change_password: userDoc?.mustChangePassword === true
    };
  }

  private async upsertPrincipal(input: {
    subject: string;
    email: string;
    name: string;
    encryptedRefreshToken: string;
  }): Promise<AuthenticatedRequestContext> {
    const existingUser = await UserModel.findOne({
      $or: [{ externalSubject: input.subject }, { email: input.email }]
    });

    if (!existingUser) {
      if (!env.AUTH_AUTO_PROVISION_USERS) {
        throw new HttpError(
          "User is not provisioned for this environment. Ask a tenant admin or platform admin to grant access.",
          403,
          "auth_user_not_provisioned"
        );
      }
      const tenant = await TenantModel.create({
        name: deriveTenantName(input.email),
        onboardingStatus: "pending"
      });
      const createdUser = await UserModel.create({
        email: input.email,
        externalSubject: input.subject,
        tenantId: String(tenant._id),
        displayName: input.name,
        encryptedRefreshToken: input.encryptedRefreshToken,
        lastLoginAt: new Date()
      });
      await TenantUserRoleModel.create({
        tenantId: String(tenant._id),
        userId: String(createdUser._id),
        role: "TENANT_ADMIN"
      });
      return buildContext(createdUser, tenant, "TENANT_ADMIN");
    }

    const isAdmin = isPlatformAdminEmail(existingUser.email);
    if (!isAdmin && existingUser.enabled === false) {
      throw new HttpError("Your account has been disabled. Contact your tenant administrator.", 403, "user_disabled");
    }

    existingUser.externalSubject = input.subject;
    existingUser.email = input.email;
    existingUser.displayName = input.name;
    existingUser.encryptedRefreshToken = input.encryptedRefreshToken;
    existingUser.lastLoginAt = new Date();
    await existingUser.save();

    const [tenant, roleRecord] = await Promise.all([
      TenantModel.findById(existingUser.tenantId).lean(),
      TenantUserRoleModel.findOne({ tenantId: existingUser.tenantId, userId: String(existingUser._id) }).lean()
    ]);
    if (!tenant) throw new Error("User tenant does not exist.");
    if (!isAdmin && tenant.enabled === false) {
      throw new HttpError("This account has been disabled. Contact your administrator.", 403, "tenant_disabled");
    }
    if (!roleRecord) throw new Error("User role does not exist.");

    return buildContext(existingUser, tenant, roleRecord.role);
  }

  private createSessionTokenForContext(context: AuthenticatedRequestContext): string {
    return createSessionToken({
      userId: context.userId,
      email: context.email,
      tenantId: context.tenantId,
      role: context.role,
      isPlatformAdmin: context.isPlatformAdmin,
      ttlSeconds: env.APP_SESSION_TTL_SECONDS,
      secret: env.APP_SESSION_SIGNING_SECRET
    });
  }
}

function buildContext(
  user: { _id: unknown; email: string; tenantId: string },
  tenant: { _id?: unknown; name: string; onboardingStatus: "pending" | "completed" },
  role: string
): AuthenticatedRequestContext {
  const tenantId = user.tenantId || String(tenant._id);
  return {
    userId: String(user._id), email: user.email, tenantId,
    tenantName: tenant.name, onboardingStatus: tenant.onboardingStatus,
    role: normalizeTenantRole(role), isPlatformAdmin: isPlatformAdminEmail(user.email)
  };
}

function deriveTenantName(email: string): string {
  return email.split("@")[0]?.trim() || "New Tenant";
}

function normalizeNextPath(value: string): string {
  return value.startsWith("/") ? value : "/";
}

function isPlatformAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && env.platformAdminEmails.includes(normalized);
}
