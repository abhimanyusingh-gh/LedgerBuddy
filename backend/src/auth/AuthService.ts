import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { AuthLoginStateModel } from "../models/AuthLoginState.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import { UserModel } from "../models/User.js";
import { env } from "../config/env.js";
import type { StsBoundary } from "../sts/StsBoundary.js";
import { createSessionToken, verifySessionToken } from "./sessionToken.js";
import { encryptSecret } from "../utils/secretCrypto.js";
import type { AuthenticatedRequestContext, SessionFlagsPayload } from "../types/auth.js";
import { TenantIntegrationModel } from "../models/TenantIntegration.js";
import { HttpError } from "../errors/HttpError.js";
import { findLocalDemoUserByEmail } from "../config/localDemoUsers.js";

interface LoginCallbackResult {
  sessionToken: string;
  redirectPath: string;
  context: AuthenticatedRequestContext;
}

export class AuthService {
  constructor(private readonly sts: StsBoundary) {}

  async getAuthorizationUrl(options: { nextPath?: string; loginHint?: string } = {}): Promise<string> {
    const state = randomBytes(24).toString("base64url");
    const codeVerifier = randomBytes(48).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const expiresAt = new Date(Date.now() + env.AUTH_STATE_TTL_SECONDS * 1000);
    const redirectUri = env.STS_REDIRECT_URI;
    const nextPath = options.nextPath ?? "/";
    const loginHint = options.loginHint?.trim().toLowerCase() ?? "";

    await AuthLoginStateModel.create({
      state,
      codeVerifier,
      redirectUri,
      nextPath: normalizeNextPath(nextPath),
      expiresAt
    });

    return this.sts.getAuthorizationUrl({
      state,
      redirectUri,
      codeChallenge,
      loginHint: loginHint.length > 0 ? loginHint : undefined,
      scopes: env.STS_SCOPES.split(" ")
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

    const tokenResult = await this.sts.exchangeAuthorizationCode({
      code,
      redirectUri: stateRecord.redirectUri,
      codeVerifier: stateRecord.codeVerifier
    });
    const validated = await this.sts.validateAccessToken({
      accessToken: tokenResult.accessToken
    });
    const claims = this.sts.normalizeClaims(validated);
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
    const normalizedPassword = password;
    if (!normalizedEmail || !normalizedPassword) {
      throw new HttpError("Email and password are required.", 400, "auth_credentials_missing");
    }

    const configuredUser = findLocalDemoUserByEmail(normalizedEmail);
    if (configuredUser) {
      if (!safeConstantTimeEquals(configuredUser.password, normalizedPassword)) {
        throw new HttpError("Invalid email or password.", 401, "auth_credentials_invalid");
      }
    } else {
      const dbUser = await UserModel.findOne({ email: normalizedEmail }).select({ passwordHash: 1 }).lean();
      if (!dbUser?.passwordHash) {
        throw new HttpError("Invalid email or password.", 401, "auth_credentials_invalid");
      }
      const inputHash = createHash("sha256").update(normalizedPassword).digest("base64url");
      if (!safeConstantTimeEquals(dbUser.passwordHash, inputHash)) {
        throw new HttpError("Invalid email or password.", 401, "auth_credentials_invalid");
      }

      if (env.ENV !== "local") {
        const verifiedCheck = await UserModel.findOne({ email: normalizedEmail }).select({ emailVerified: 1 }).lean();
        if (!verifiedCheck?.emailVerified) {
          throw new HttpError("Please verify your email before logging in.", 403, "auth_email_not_verified");
        }
      }
    }

    const context = await this.resolvePrincipalByEmail(normalizedEmail);
    await UserModel.updateOne(
      { _id: context.userId },
      {
        $set: {
          lastLoginAt: new Date()
        }
      }
    );

    return {
      sessionToken: this.createSessionTokenForContext(context),
      context
    };
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

    return {
      userId: String(user._id),
      email: user.email,
      tenantId: verified.tenantId,
      tenantName: tenant.name,
      onboardingStatus: tenant.onboardingStatus,
      role: verified.role,
      isPlatformAdmin: verified.isPlatformAdmin
    };
  }

  async getSessionFlags(context: AuthenticatedRequestContext): Promise<SessionFlagsPayload> {
    const [gmailIntegration, userDoc] = await Promise.all([
      TenantIntegrationModel.findOne({
        tenantId: context.tenantId,
        provider: "gmail"
      }).lean(),
      UserModel.findById(context.userId).select({ mustChangePassword: 1, emailVerified: 1 }).lean()
    ]);
    const requiresReauth = gmailIntegration?.status === "requires_reauth";
    const isAdmin = context.role === "TENANT_ADMIN";

    return {
      requires_tenant_setup: context.onboardingStatus !== "completed",
      requires_reauth: requiresReauth,
      requires_admin_action: requiresReauth && isAdmin,
      requires_email_confirmation: !userDoc?.emailVerified && env.ENV !== "local",
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

    existingUser.externalSubject = input.subject;
    existingUser.email = input.email;
    existingUser.displayName = input.name;
    existingUser.encryptedRefreshToken = input.encryptedRefreshToken;
    existingUser.lastLoginAt = new Date();
    await existingUser.save();

    const tenant = await TenantModel.findById(existingUser.tenantId).lean();
    if (!tenant) throw new Error("User tenant does not exist.");
    const roleRecord = await TenantUserRoleModel.findOne({
      tenantId: existingUser.tenantId, userId: String(existingUser._id)
    }).lean();
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

  private async resolvePrincipalByEmail(email: string): Promise<AuthenticatedRequestContext> {
    const user = await UserModel.findOne({ email }).lean();
    if (!user) throw new HttpError("User is not provisioned for this environment.", 403, "auth_user_not_provisioned");
    const tenant = await TenantModel.findById(user.tenantId).lean();
    if (!tenant) throw new HttpError("Tenant not found.", 401, "auth_tenant_missing");
    const roleRecord = await TenantUserRoleModel.findOne({ tenantId: user.tenantId, userId: String(user._id) }).lean();
    if (!roleRecord) throw new HttpError("User has no assigned tenant role.", 401, "auth_role_missing");
    return buildContext(user, tenant, roleRecord.role);
  }
}

function buildContext(
  user: { _id: unknown; email: string; tenantId: string },
  tenant: { _id?: unknown; name: string; onboardingStatus: "pending" | "completed" },
  role: "TENANT_ADMIN" | "MEMBER"
): AuthenticatedRequestContext {
  const tenantId = user.tenantId || String(tenant._id);
  return {
    userId: String(user._id), email: user.email, tenantId,
    tenantName: tenant.name, onboardingStatus: tenant.onboardingStatus,
    role, isPlatformAdmin: isPlatformAdminEmail(user.email)
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

function safeConstantTimeEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  if (expectedBuffer.length !== actualBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
