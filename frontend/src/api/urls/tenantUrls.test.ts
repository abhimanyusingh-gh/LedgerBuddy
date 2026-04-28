/**
 * @jest-environment jsdom
 */
import { tenantUrls } from "@/api/urls/tenantUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/tenantUrls — id-bearing routes", () => {
  it("userRole encodes the user id and appends /role", () => {
    expect(tenantUrls.userRole("user/42")).toBe(
      "/tenants/tenant-1/admin/users/user%2F42/role"
    );
  });

  it("userDelete encodes the user id into the tenant-scoped path", () => {
    expect(tenantUrls.userDelete("user 7")).toBe(
      "/tenants/tenant-1/admin/users/user%207"
    );
  });

  it("userEnabled encodes the user id and appends /enabled", () => {
    expect(tenantUrls.userEnabled("user#9")).toBe(
      "/tenants/tenant-1/admin/users/user%239/enabled"
    );
  });
});

describe("api/urls/tenantUrls — missing-context guards", () => {
  // Tenant-scoped routes only require tenantId, but the codebase uses one
  // error class (`MissingActiveClientOrgError`) for both missing-tenant and
  // missing-clientOrg per the Sub-PR C re-review note.
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => tenantUrls.usersList()).toThrow(MissingActiveClientOrgError);
    expect(() => tenantUrls.usersInvite()).toThrow(MissingActiveClientOrgError);
    expect(() => tenantUrls.userRole("user-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => tenantUrls.userDelete("user-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => tenantUrls.userEnabled("user-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => tenantUrls.onboardingComplete()).toThrow(
      MissingActiveClientOrgError
    );
  });
});
