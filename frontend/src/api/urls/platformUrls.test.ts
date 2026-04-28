/**
 * @jest-environment jsdom
 */
import { platformUrls } from "@/api/urls/platformUrls";

describe("api/urls/platformUrls — tenant-agnostic routes", () => {
  it.each([
    ["authToken", "/auth/token"],
    ["authRefresh", "/auth/refresh"],
    ["authChangePassword", "/auth/change-password"],
    ["session", "/session"],
    ["platformTenantsUsage", "/platform/tenants/usage"],
    ["platformTenantsOnboardAdmin", "/platform/tenants/onboard-admin"],
    ["complianceTdsRates", "/compliance/tds-rates"],
    ["complianceTdsSections", "/compliance/tds-sections"],
    ["complianceRiskSignals", "/compliance/risk-signals"]
  ] as const)("%s resolves to %s", (method, expected) => {
    const fn = platformUrls[method] as () => string;
    expect(fn()).toBe(expected);
  });
});

describe("api/urls/platformUrls — id-bearing routes", () => {
  it("platformTenantEnabled encodes the tenant id and appends /enabled", () => {
    expect(platformUrls.platformTenantEnabled("tenant/42")).toBe(
      "/platform/tenants/tenant%2F42/enabled"
    );
  });

  it("platformTenantEnabled handles plain ids", () => {
    expect(platformUrls.platformTenantEnabled("tenant-1")).toBe(
      "/platform/tenants/tenant-1/enabled"
    );
  });
});
