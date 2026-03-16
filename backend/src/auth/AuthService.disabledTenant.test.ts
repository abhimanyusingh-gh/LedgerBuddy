import { AuthService } from "./AuthService.js";
import { createSessionToken } from "./sessionToken.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { TenantModel } from "../models/Tenant.js";

jest.mock("../config/localDemoUsers.js", () => ({
  findLocalDemoUserByEmail: jest.fn()
}));

const { findLocalDemoUserByEmail } = jest.requireMock("../config/localDemoUsers.js") as {
  findLocalDemoUserByEmail: jest.Mock;
};

const TENANT_ID = "65f0000000000000000000a1";
const USER_ID = "65f0000000000000000000c3";

function mockUser(overrides: Partial<{ email: string; enabled: boolean }> = {}) {
  jest.spyOn(UserModel, "findById").mockReturnValue({
    lean: jest.fn().mockResolvedValue({
      _id: USER_ID, email: overrides.email ?? "user@test.com",
      tenantId: TENANT_ID, enabled: overrides.enabled ?? true
    })
  } as never);
}

function mockTenant(overrides: Partial<{ enabled: boolean }> = {}) {
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

describe("AuthService disabled tenant/user", () => {
  const authService = new AuthService({} as never);

  beforeEach(() => {
    jest.restoreAllMocks();
    findLocalDemoUserByEmail.mockReset();
  });

  it("blocks when tenant is disabled", async () => {
    mockUser();
    mockTenant({ enabled: false });
    await expect(authService.resolveRequestContext(makeToken())).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "tenant_disabled" })
    );
  });

  it("blocks when user is disabled", async () => {
    mockUser({ enabled: false });
    mockTenant();
    await expect(authService.resolveRequestContext(makeToken())).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "user_disabled" })
    );
  });

});
