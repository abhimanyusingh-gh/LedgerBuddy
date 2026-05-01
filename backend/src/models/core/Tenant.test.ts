import { describeHarness } from "@/test-utils";
import { TenantModel } from "@/models/core/Tenant.js";
import { TAN_FORMAT, isTAN, toTAN } from "@/types/tan.js";
import { ONBOARDING_STATUS } from "@/types/onboarding.js";

describe("Tenant TAN type module", () => {
  it.each([
    ["valid uppercase ABCD12345E", "ABCD12345E", true],
    ["valid uppercase ZZZZ99999Z", "ZZZZ99999Z", true],
    ["invalid lowercase prefix", "abcd12345E", false],
    ["invalid digits-in-prefix", "AB1D12345E", false],
    ["invalid 9 chars", "ABCD12345", false],
    ["invalid 11 chars", "ABCD12345EF", false],
    ["empty", "", false]
  ])("TAN_FORMAT: %s", (_label, value, expected) => {
    expect(TAN_FORMAT.test(value)).toBe(expected);
    expect(isTAN(value)).toBe(expected);
  });

  it("toTAN brand cast preserves the underlying string", () => {
    const branded = toTAN("ABCD12345E");
    expect(branded).toBe("ABCD12345E");
  });
});

describe("Tenant schema TAN field", () => {
  it("declares tan path with default null and a custom validator", () => {
    const path = TenantModel.schema.paths.tan as unknown as {
      defaultValue: unknown;
      validators: Array<{ message?: string; validator: (v: unknown) => boolean }>;
    };
    expect(path.defaultValue).toBeNull();
    const validators = path.validators ?? [];
    const tanValidator = validators.find((v) => typeof v.message === "string" && /TAN/.test(v.message ?? ""));
    expect(tanValidator).toBeDefined();
  });
});

describeHarness("Tenant TAN persistence + validation", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  function buildTenantPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: "ACME CA",
      onboardingStatus: ONBOARDING_STATUS.PENDING,
      ...overrides
    };
  }

  it("persists null tan by default for legacy/new tenant rows", async () => {
    const tenant = await TenantModel.create(buildTenantPayload());
    expect(tenant.tan).toBeNull();
  });

  it("accepts a valid TAN", async () => {
    const tenant = await TenantModel.create(buildTenantPayload({ tan: "ABCD12345E" }));
    expect(tenant.tan).toBe("ABCD12345E");
  });

  it("rejects a malformed TAN (lowercase / wrong shape)", async () => {
    await expect(
      TenantModel.create(buildTenantPayload({ tan: "abcd12345e" }))
    ).rejects.toThrow(/TAN/);
  });

  it("rejects a TAN with digits in the prefix block", async () => {
    await expect(
      TenantModel.create(buildTenantPayload({ tan: "AB1D12345E" }))
    ).rejects.toThrow(/TAN/);
  });
});
