import {
  FeatureFlagEvaluator,
  applyTargeting,
  type FeatureFlagOverrideStore
} from "@/services/flags/featureFlagEvaluator.js";
import {
  FEATURE_FLAG_REGISTRY,
  FEATURE_FLAG_TARGETING_KIND,
  type FeatureFlagDefinition,
  type FeatureFlagName
} from "@/services/flags/featureFlagRegistry.js";

const CANARY_FLAG: FeatureFlagName = "example.healthCheckVerbose";

interface StubStoreState {
  overrides: Record<string, boolean | null>;
  calls: number;
}

function createStubStore(state: StubStoreState): FeatureFlagOverrideStore {
  return {
    async findOverride(flagName: string, tenantId: string) {
      state.calls += 1;
      const scoped = state.overrides[`${flagName}::${tenantId}`];
      if (scoped !== undefined) return scoped;
      const global = state.overrides[`${flagName}::*`];
      return global === undefined ? null : global;
    }
  };
}

function registryWith(flagName: string, definition: FeatureFlagDefinition) {
  return { [flagName]: definition };
}

describe("FeatureFlagEvaluator", () => {
  it("returns the registry default when no override applies", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({ overrideStore: createStubStore(state) });
    const enabled = await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" });
    expect(enabled).toBe(FEATURE_FLAG_REGISTRY[CANARY_FLAG].defaultEnabled);
  });

  it("respects a global DB override over the registry default", async () => {
    const state: StubStoreState = {
      overrides: { [`${CANARY_FLAG}::*`]: true },
      calls: 0
    };
    const evaluator = new FeatureFlagEvaluator({ overrideStore: createStubStore(state) });
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })).toBe(true);
  });

  it("prefers tenant-scoped override over global override", async () => {
    const state: StubStoreState = {
      overrides: {
        [`${CANARY_FLAG}::*`]: true,
        [`${CANARY_FLAG}::t1`]: false
      },
      calls: 0
    };
    const evaluator = new FeatureFlagEvaluator({ overrideStore: createStubStore(state) });
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })).toBe(false);
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t2" })).toBe(true);
  });

  it("applies tenant allowlist targeting via applyTargeting", () => {
    const definition: FeatureFlagDefinition = {
      description: "test",
      defaultEnabled: false,
      targeting: [
        { kind: FEATURE_FLAG_TARGETING_KIND.TENANT_ALLOWLIST, tenantIds: ["tenant-allow"] }
      ]
    };
    expect(applyTargeting(definition, "f", { tenantId: "tenant-allow" })).toBe(true);
    expect(applyTargeting(definition, "f", { tenantId: "other" })).toBe(false);
  });

  it("applies tenant denylist targeting via applyTargeting", () => {
    const definition: FeatureFlagDefinition = {
      description: "test",
      defaultEnabled: true,
      targeting: [
        { kind: FEATURE_FLAG_TARGETING_KIND.TENANT_DENYLIST, tenantIds: ["tenant-deny"] }
      ]
    };
    expect(applyTargeting(definition, "f", { tenantId: "tenant-deny" })).toBe(false);
    expect(applyTargeting(definition, "f", { tenantId: "other" })).toBe(true);
  });

  it("percentage rollout is deterministic and roughly proportional", () => {
    const definition: FeatureFlagDefinition = {
      description: "test",
      defaultEnabled: false,
      targeting: [
        { kind: FEATURE_FLAG_TARGETING_KIND.PERCENTAGE_ROLLOUT, percentage: 50 }
      ]
    };
    const sample = Array.from({ length: 400 }, (_unused, index) => `tenant-${index}`);
    const firstPass = sample.map((id) => applyTargeting(definition, "f", { tenantId: id }));
    const secondPass = sample.map((id) => applyTargeting(definition, "f", { tenantId: id }));
    expect(firstPass).toEqual(secondPass);
    const enabledCount = firstPass.filter(Boolean).length;
    expect(enabledCount).toBeGreaterThan(150);
    expect(enabledCount).toBeLessThan(250);
  });

  it("evaluator routes through an injected registry", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({
      overrideStore: createStubStore(state),
      registry: registryWith(CANARY_FLAG, {
        description: "test",
        defaultEnabled: false,
        targeting: [
          { kind: FEATURE_FLAG_TARGETING_KIND.TENANT_ALLOWLIST, tenantIds: ["tenant-allow"] }
        ]
      })
    });
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "tenant-allow" })).toBe(true);
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "other" })).toBe(false);
  });

  it("caches override lookups within TTL and refreshes after expiry", async () => {
    const state: StubStoreState = {
      overrides: { [`${CANARY_FLAG}::t1`]: true },
      calls: 0
    };
    let nowValue = 1_000;
    const evaluator = new FeatureFlagEvaluator({
      overrideStore: createStubStore(state),
      ttlMs: 100,
      now: () => nowValue
    });

    await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" });
    await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" });
    expect(state.calls).toBe(1);

    nowValue += 500;
    await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" });
    expect(state.calls).toBe(2);
  });

  it("reflects hot-toggle by re-reading the store after TTL expiry", async () => {
    const state: StubStoreState = {
      overrides: { [`${CANARY_FLAG}::t1`]: false },
      calls: 0
    };
    let nowValue = 1_000;
    const evaluator = new FeatureFlagEvaluator({
      overrideStore: createStubStore(state),
      ttlMs: 100,
      now: () => nowValue
    });

    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })).toBe(false);

    state.overrides[`${CANARY_FLAG}::t1`] = true;
    nowValue += 50;
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })).toBe(false);

    nowValue += 200;
    expect(await evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })).toBe(true);
  });

  it("evaluateAll returns every registered flag", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({ overrideStore: createStubStore(state) });
    const all = await evaluator.evaluateAll({ tenantId: "t1" });
    expect(Object.keys(all).sort()).toEqual(Object.keys(FEATURE_FLAG_REGISTRY).sort());
  });

  it("evaluateGlobal returns the registry default for a boolean-kind flag with no targeting", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({ overrideStore: createStubStore(state) });
    const enabled = await evaluator.evaluateGlobal(CANARY_FLAG);
    expect(enabled).toBe(FEATURE_FLAG_REGISTRY[CANARY_FLAG].defaultEnabled);
  });

  it("evaluateGlobal throws when the flag declares percentage-rollout targeting", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({
      overrideStore: createStubStore(state),
      registry: registryWith(CANARY_FLAG, {
        description: "test",
        defaultEnabled: false,
        targeting: [
          { kind: FEATURE_FLAG_TARGETING_KIND.PERCENTAGE_ROLLOUT, percentage: 50 }
        ]
      })
    });
    await expect(evaluator.evaluateGlobal(CANARY_FLAG)).rejects.toThrow(/tenant targeting/);
  });

  it("throws on unknown flag names", async () => {
    const state: StubStoreState = { overrides: {}, calls: 0 };
    const evaluator = new FeatureFlagEvaluator({
      overrideStore: createStubStore(state),
      registry: {}
    });
    await expect(
      evaluator.isEnabled(CANARY_FLAG, { tenantId: "t1" })
    ).rejects.toThrow(/Unknown feature flag/);
  });
});

describe("FEATURE_FLAG_REGISTRY completeness", () => {
  it.each(Object.entries(FEATURE_FLAG_REGISTRY))(
    "flag %s has a non-empty description",
    (_name, definition) => {
      expect((definition as FeatureFlagDefinition).description.trim().length).toBeGreaterThan(0);
    }
  );

  it.each(Object.entries(FEATURE_FLAG_REGISTRY))(
    "flag %s declares a boolean default",
    (_name, definition) => {
      expect(typeof (definition as FeatureFlagDefinition).defaultEnabled).toBe("boolean");
    }
  );
});
