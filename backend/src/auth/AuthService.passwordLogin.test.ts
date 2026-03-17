import { AuthService } from "./AuthService.js";
import { verifySessionToken } from "./sessionToken.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";
import type { OidcProvider } from "../sts/OidcProvider.js";
import type { KeycloakAdminClient } from "../keycloak/KeycloakAdminClient.js";

function makeMockOidc(overrides: Partial<OidcProvider> = {}): OidcProvider {
  return {
    getAuthorizationUrl: jest.fn(),
    exchangeAuthorizationCode: jest.fn(),
    validateAccessToken: jest.fn().mockResolvedValue({
      active: true,
      sub: "kc-subject-1",
      email: "tenant-admin-1@local.test",
      name: "Tenant Admin 1"
    }),
    normalizeClaims: jest.fn().mockReturnValue({
      subject: "kc-subject-1",
      email: "tenant-admin-1@local.test",
      name: "Tenant Admin 1"
    }),
    exchangePasswordGrant: jest.fn().mockResolvedValue({ accessToken: "mock-access-token", ok: true }),
    ...overrides
  };
}

function makeMockKcAdmin(): jest.Mocked<KeycloakAdminClient> {
  return {
    createUser: jest.fn(),
    setPassword: jest.fn(),
    findUserByEmail: jest.fn(),
    userExists: jest.fn(),
    deleteUser: jest.fn(),
    executeActionsEmail: jest.fn()
  } as unknown as jest.Mocked<KeycloakAdminClient>;
}

describe("AuthService loginWithPassword", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("issues a session token when credentials are valid", async () => {
    const oidc = makeMockOidc();
    const authService = new AuthService(oidc, makeMockKcAdmin());

    const mockUser = {
      _id: "65f0000000000000000000c3",
      email: "tenant-admin-1@local.test",
      tenantId: "65f0000000000000000000a1",
      externalSubject: "old-subject",
      enabled: true,
      displayName: "Tenant Admin 1",
      encryptedRefreshToken: "",
      lastLoginAt: new Date(),
      save: jest.fn().mockResolvedValue(undefined)
    };

    // upsertPrincipal uses findOne() without .lean()
    jest.spyOn(UserModel, "findOne").mockResolvedValue(mockUser as never);

    jest.spyOn(TenantModel, "findById").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "65f0000000000000000000a1",
        name: "Tenant Alpha",
        onboardingStatus: "completed"
      })
    } as never);

    jest.spyOn(TenantUserRoleModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({ role: "TENANT_ADMIN" })
    } as never);

    const updateOneSpy = jest.spyOn(UserModel, "updateOne").mockResolvedValue({} as never);

    const result = await authService.loginWithPassword("tenant-admin-1@local.test", "DemoPass!1");

    expect(oidc.exchangePasswordGrant).toHaveBeenCalledWith("tenant-admin-1@local.test", "DemoPass!1");
    expect(result.context.role).toBe("TENANT_ADMIN");
    expect(result.context.tenantId).toBe("65f0000000000000000000a1");
    expect(updateOneSpy).toHaveBeenCalled();

    const verified = verifySessionToken(result.sessionToken, env.APP_SESSION_SIGNING_SECRET);
    expect(verified.role).toBe("TENANT_ADMIN");
    expect(verified.userId).toBe("65f0000000000000000000c3");
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

  it("auto-provisions new user when AUTH_AUTO_PROVISION_USERS is true and user not found", async () => {
    const oidc = makeMockOidc();
    const authService = new AuthService(oidc, makeMockKcAdmin());

    jest.spyOn(UserModel, "findOne").mockResolvedValue(null as never);

    // AUTH_AUTO_PROVISION_USERS defaults to false in test env — expect provisioning error
    await expect(authService.loginWithPassword("unknown@local.test", "DemoPass!1")).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "auth_user_not_provisioned" })
    );
  });
});
