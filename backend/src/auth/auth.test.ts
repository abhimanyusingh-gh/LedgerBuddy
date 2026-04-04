import { createHmac } from "node:crypto";
import type { Request, Response } from "express";
import { AuthService } from "./AuthService.js";
import { createSessionToken, verifySessionToken } from "./sessionToken.js";
import { createAuthenticationMiddleware, requireNotViewer, resolveBearerToken } from "./middleware.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import type { OidcProvider } from "../sts/OidcProvider.js";
import type { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";

const TENANT_ID = "65f0000000000000000000a1";
const USER_ID = "65f0000000000000000000c3";

function mockUserLookup(overrides: Partial<{ email: string; enabled: boolean }> = {}) {
  jest.spyOn(UserModel, "findById").mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: USER_ID, email: overrides.email ?? "user@test.com",
      tenantId: TENANT_ID, enabled: overrides.enabled ?? true
    })
  } as never);
}

function mockTenantLookup(overrides: Partial<{ enabled: boolean }> = {}) {
  jest.spyOn(TenantModel, "findById").mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: TENANT_ID, name: "Tenant", onboardingStatus: "completed",
      enabled: overrides.enabled ?? true
    })
  } as never);
}

function makeToken(overrides: Partial<{ email: string; isPlatformAdmin: boolean }> = {}) {
  return createSessionToken({
    userId: USER_ID, email: overrides.email ?? "user@test.com",
    tenantId: TENANT_ID, role: "TENANT_ADMIN",
    isPlatformAdmin: overrides.isPlatformAdmin ?? false,
    ttlSeconds: 3600, secret: env.APP_SESSION_SIGNING_SECRET
  });
}

function makeMockOidc(overrides: Partial<OidcProvider> = {}): OidcProvider {
  return {
    getAuthorizationUrl: jest.fn(),
    exchangeAuthorizationCode: jest.fn(),
    validateAccessToken: jest.fn().mockResolvedValue({
      active: true, sub: "kc-subject-1",
      email: "tenant-admin-1@local.test", name: "Tenant Admin 1"
    }),
    normalizeClaims: jest.fn().mockReturnValue({
      subject: "kc-subject-1", email: "tenant-admin-1@local.test", name: "Tenant Admin 1"
    }),
    exchangePasswordGrant: jest.fn().mockResolvedValue({ accessToken: "mock-access-token", ok: true }),
    ...overrides
  };
}

function makeMockKcAdmin(): jest.Mocked<KeycloakAdminClient> {
  return {
    createUser: jest.fn(), setPassword: jest.fn(), findUserByEmail: jest.fn(),
    userExists: jest.fn(), deleteUser: jest.fn(), executeActionsEmail: jest.fn()
  } as unknown as jest.Mocked<KeycloakAdminClient>;
}

describe("disabled tenant/user", () => {
  const authService = new AuthService({} as never, {} as never);

  beforeEach(() => { jest.restoreAllMocks(); });

  it("blocks when tenant is disabled", async () => {
    mockUserLookup();
    mockTenantLookup({ enabled: false });
    await expect(authService.resolveRequestContext(makeToken())).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "tenant_disabled" })
    );
  });

  it("blocks when user is disabled", async () => {
    mockUserLookup({ enabled: false });
    mockTenantLookup();
    await expect(authService.resolveRequestContext(makeToken())).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "user_disabled" })
    );
  });
});

describe("loginWithPassword", () => {
  beforeEach(() => { jest.restoreAllMocks(); });

  it("issues a session token when credentials are valid", async () => {
    const oidc = makeMockOidc();
    const authService = new AuthService(oidc, makeMockKcAdmin());

    const mockUser = {
      _id: USER_ID, email: "tenant-admin-1@local.test",
      tenantId: TENANT_ID, externalSubject: "old-subject",
      enabled: true, displayName: "Tenant Admin 1",
      encryptedRefreshToken: "", lastLoginAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined)
    };
    jest.spyOn(UserModel, "findOne").mockResolvedValue(mockUser as never);
    jest.spyOn(TenantModel, "findById").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ _id: TENANT_ID, name: "Tenant Alpha", onboardingStatus: "completed" })
    } as never);
    jest.spyOn(TenantUserRoleModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" })
    } as never);
    const updateOneSpy = jest.spyOn(UserModel, "updateOne").mockResolvedValue({} as never);

    const result = await authService.loginWithPassword("tenant-admin-1@local.test", "DemoPass!1");

    expect(oidc.exchangePasswordGrant).toHaveBeenCalledWith("tenant-admin-1@local.test", "DemoPass!1");
    expect(result.context.role).toBe("TENANT_ADMIN");
    expect(result.context.tenantId).toBe(TENANT_ID);
    expect(updateOneSpy).toHaveBeenCalled();

    const verified = verifySessionToken(result.sessionToken, env.APP_SESSION_SIGNING_SECRET);
    expect(verified.role).toBe("TENANT_ADMIN");
    expect(verified.userId).toBe(USER_ID);
  });

  it("rejects login when ROPC returns not-ok", async () => {
    const oidc = makeMockOidc({
      exchangePasswordGrant: jest.fn().mockResolvedValue({ accessToken: "", ok: false })
    });
    const authService = new AuthService(oidc, makeMockKcAdmin());
    await expect(authService.loginWithPassword("tenant-admin-1@local.test", "wrong")).rejects.toEqual(
      expect.objectContaining({ statusCode: 401, code: "auth_credentials_invalid" })
    );
  });

  it("rejects login when email is empty", async () => {
    const authService = new AuthService(makeMockOidc(), makeMockKcAdmin());
    await expect(authService.loginWithPassword("", "DemoPass!1")).rejects.toEqual(
      expect.objectContaining({ statusCode: 400, code: "auth_credentials_missing" })
    );
  });

  it("rejects when user not found and not auto-provisioned", async () => {
    const authService = new AuthService(makeMockOidc(), makeMockKcAdmin());
    jest.spyOn(UserModel, "findOne").mockResolvedValue(null as never);
    await expect(authService.loginWithPassword("unknown@local.test", "DemoPass!1")).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "auth_user_not_provisioned" })
    );
  });
});

describe("auth middleware", () => {
  it("prefers authToken query when authorization header token is invalid", () => {
    const request = {
      header: (name: string) => (name.toLowerCase() === "authorization" ? "Bearer undefined" : undefined),
      path: "/jobs/ingest/sse",
      query: { authToken: "query-token-1" }
    } as unknown as Request;
    expect(resolveBearerToken(request)).toBe("query-token-1");
  });

  it("uses query token when authorization header is missing", () => {
    const request = {
      header: () => undefined,
      path: "/invoices/abc123/preview",
      query: { authToken: "query-token-2" }
    } as unknown as Request;
    expect(resolveBearerToken(request)).toBe("query-token-2");
  });

  it("ignores query token on non-allowlisted paths", () => {
    const request = {
      header: () => undefined,
      path: "/invoices",
      query: { authToken: "sneaky-token" }
    } as unknown as Request;
    expect(resolveBearerToken(request)).toBe("");
  });

  it("allows query token on ocr-block crop paths", () => {
    const request = {
      header: () => undefined,
      path: "/invoices/abc123/ocr-blocks/5/crop",
      query: { authToken: "crop-token" }
    } as unknown as Request;
    expect(resolveBearerToken(request)).toBe("crop-token");
  });

  it("allows query token on source-overlay paths", () => {
    const request = {
      header: () => undefined,
      path: "/invoices/abc123/source-overlays/vendorName",
      query: { authToken: "overlay-token" }
    } as unknown as Request;
    expect(resolveBearerToken(request)).toBe("overlay-token");
  });

  it("authenticates request using query token", async () => {
    const authService = {
      resolveRequestContext: jest.fn().mockResolvedValue({
        userId: "u1", email: "u@example.com", tenantId: "t1",
        tenantName: "Tenant", onboardingStatus: "completed",
        role: "TENANT_ADMIN", isPlatformAdmin: false
      })
    };
    const middleware = createAuthenticationMiddleware(authService as never);
    const request = {
      header: () => undefined,
      path: "/invoices/abc123/preview",
      query: { authToken: "image-token" }
    } as unknown as Request;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();

    await middleware(request, response, next);

    expect(authService.resolveRequestContext).toHaveBeenCalledWith("image-token");
    expect(next).toHaveBeenCalledTimes(1);
    expect((request as { authContext?: unknown }).authContext).toBeTruthy();
  });
});

describe("requireNotViewer", () => {
  it("blocks audit_clerk role with 403", () => {
    const request = { authContext: { userId: "v1", role: "audit_clerk" } } as unknown as Request;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    requireNotViewer(request, response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("allows ap_clerk role", () => {
    const request = { authContext: { userId: "m1", role: "ap_clerk" } } as unknown as Request;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    requireNotViewer(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("allows TENANT_ADMIN role", () => {
    const request = { authContext: { userId: "a1", role: "TENANT_ADMIN" } } as unknown as Request;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    requireNotViewer(request, response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when authContext is missing", () => {
    const request = { authContext: null } as unknown as Request;
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
    const next = jest.fn();
    requireNotViewer(request, response, next);
    expect(response.status).toHaveBeenCalledWith(401);
  });
});

describe("sessionToken", () => {
  const secret = "test-secret";

  it("encodes and decodes role and platform claims", () => {
    const token = createSessionToken({
      userId: "user-1", email: "user@example.com", tenantId: "tenant-1",
      role: "TENANT_ADMIN", isPlatformAdmin: true, ttlSeconds: 600, secret
    });
    const verified = verifySessionToken(token, secret);
    expect(verified).toEqual({
      userId: "user-1", email: "user@example.com", tenantId: "tenant-1",
      role: "TENANT_ADMIN", isPlatformAdmin: true
    });
  });

  it("rejects token payload without valid role", () => {
    const token = createSessionToken({
      userId: "user-1", email: "user@example.com", tenantId: "tenant-1",
      role: "ap_clerk", isPlatformAdmin: false, ttlSeconds: 600, secret
    });
    const [header, payload] = token.split(".");
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    parsed.role = "UNKNOWN";
    const tamperedPayload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
    const signature = createHmac("sha256", secret).update(`${header}.${tamperedPayload}`).digest("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;
    expect(() => verifySessionToken(tampered, secret)).toThrow(/payload is incomplete/i);
  });
});
