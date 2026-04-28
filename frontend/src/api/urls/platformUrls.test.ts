/**
 * @jest-environment jsdom
 */
import { platformUrls } from "@/api/urls/platformUrls";

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
