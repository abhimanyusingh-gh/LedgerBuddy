import { AuthService } from "./AuthService.js";
import { verifySessionToken } from "./sessionToken.js";
import { env } from "../config/env.js";
import { UserModel } from "../models/User.js";
import { TenantModel } from "../models/Tenant.js";
import { TenantUserRoleModel } from "../models/TenantUserRole.js";

jest.mock("../config/localDemoUsers.js", () => ({
  findLocalDemoUserByEmail: jest.fn()
}));

const { findLocalDemoUserByEmail } = jest.requireMock("../config/localDemoUsers.js") as {
  findLocalDemoUserByEmail: jest.Mock;
};

describe("AuthService loginWithPassword", () => {
  const authService = new AuthService({} as never);

  beforeEach(() => {
    jest.restoreAllMocks();
    findLocalDemoUserByEmail.mockReset();
  });

  it("issues a session token when credentials are valid", async () => {
    findLocalDemoUserByEmail.mockReturnValue({
      email: "tenant-admin-1@local.test",
      password: "DemoPass!1",
      tenantId: "65f0000000000000000000a1",
      role: "TENANT_ADMIN"
    });

    jest.spyOn(UserModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "65f0000000000000000000c3",
        email: "tenant-admin-1@local.test",
        tenantId: "65f0000000000000000000a1"
      })
    } as never);

    jest.spyOn(TenantModel, "findById").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        _id: "65f0000000000000000000a1",
        name: "Tenant Alpha",
        onboardingStatus: "completed"
      })
    } as never);

    jest.spyOn(TenantUserRoleModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        role: "TENANT_ADMIN"
      })
    } as never);

    const updateOneSpy = jest.spyOn(UserModel, "updateOne").mockResolvedValue({} as never);

    const result = await authService.loginWithPassword("tenant-admin-1@local.test", "DemoPass!1");

    expect(result.context.role).toBe("TENANT_ADMIN");
    expect(result.context.tenantId).toBe("65f0000000000000000000a1");
    expect(updateOneSpy).toHaveBeenCalled();

    const verified = verifySessionToken(result.sessionToken, env.APP_SESSION_SIGNING_SECRET);
    expect(verified.role).toBe("TENANT_ADMIN");
    expect(verified.userId).toBe("65f0000000000000000000c3");
  });

  it("rejects login when password is invalid", async () => {
    findLocalDemoUserByEmail.mockReturnValue({
      email: "tenant-admin-1@local.test",
      password: "DemoPass!1"
    });

    await expect(authService.loginWithPassword("tenant-admin-1@local.test", "wrong")).rejects.toEqual(
      expect.objectContaining({ statusCode: 401, code: "auth_credentials_invalid" })
    );
  });

  it("rejects login for unknown local user", async () => {
    findLocalDemoUserByEmail.mockReturnValue(null);
    jest.spyOn(UserModel, "findOne").mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      })
    } as never);

    await expect(authService.loginWithPassword("unknown@local.test", "DemoPass!1")).rejects.toEqual(
      expect.objectContaining({ statusCode: 401, code: "auth_credentials_invalid" })
    );
  });

  it("throws when provisioned user is missing from database", async () => {
    findLocalDemoUserByEmail.mockReturnValue({
      email: "tenant-admin-1@local.test",
      password: "DemoPass!1"
    });
    jest.spyOn(UserModel, "findOne").mockReturnValue({
      lean: jest.fn().mockResolvedValue(null)
    } as never);

    await expect(authService.loginWithPassword("tenant-admin-1@local.test", "DemoPass!1")).rejects.toEqual(
      expect.objectContaining({ statusCode: 403, code: "auth_user_not_provisioned" })
    );
  });
});
