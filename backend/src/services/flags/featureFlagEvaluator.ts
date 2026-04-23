import { createHash } from "node:crypto";
import {
  FEATURE_FLAG_REGISTRY,
  FEATURE_FLAG_TARGETING_KIND,
  type FeatureFlagDefinition,
  type FeatureFlagName,
  type FeatureFlagTargetingRule
} from "@/services/flags/featureFlagRegistry.js";
import {
  FEATURE_FLAG_OVERRIDE_SCOPE,
  FeatureFlagOverrideModel
} from "@/models/core/FeatureFlagOverride.js";

interface FeatureFlagContext {
  readonly tenantId: string;
}

export interface FeatureFlagOverrideStore {
  findOverride(flagName: string, tenantId: string): Promise<boolean | null>;
}

interface FeatureFlagEvaluatorOptions {
  ttlMs?: number;
  overrideStore?: FeatureFlagOverrideStore;
  registry?: Record<string, FeatureFlagDefinition>;
  now?: () => number;
}

const DEFAULT_TTL_MS = 30_000;

interface CachedOverride {
  enabled: boolean;
  expiresAt: number;
}

function scoreTenantForPercentage(tenantId: string, flagName: string): number {
  const digest = createHash("sha256").update(`${tenantId}:${flagName}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function applyRule(
  rule: FeatureFlagTargetingRule,
  current: boolean,
  flagName: string,
  context: FeatureFlagContext
): boolean {
  if (rule.kind === FEATURE_FLAG_TARGETING_KIND.TENANT_ALLOWLIST) {
    return rule.tenantIds.includes(context.tenantId) ? true : current;
  }
  if (rule.kind === FEATURE_FLAG_TARGETING_KIND.TENANT_DENYLIST) {
    return rule.tenantIds.includes(context.tenantId) ? false : current;
  }
  if (rule.kind === FEATURE_FLAG_TARGETING_KIND.PERCENTAGE_ROLLOUT) {
    const bucket = scoreTenantForPercentage(context.tenantId, flagName);
    return bucket < rule.percentage ? true : current;
  }
  return current;
}

export function applyTargeting(
  definition: FeatureFlagDefinition,
  flagName: string,
  context: FeatureFlagContext
): boolean {
  let enabled = definition.defaultEnabled;
  for (const rule of definition.targeting) {
    enabled = applyRule(rule, enabled, flagName, context);
  }
  return enabled;
}

class MongoOverrideStore implements FeatureFlagOverrideStore {
  async findOverride(flagName: string, tenantId: string): Promise<boolean | null> {
    const docs = await FeatureFlagOverrideModel.find({
      flagName,
      $or: [
        { scope: FEATURE_FLAG_OVERRIDE_SCOPE.TENANT, tenantId },
        { scope: FEATURE_FLAG_OVERRIDE_SCOPE.GLOBAL }
      ]
    })
      .lean()
      .exec();
    if (docs.length === 0) return null;
    const tenantDoc = docs.find(
      (doc) => doc.scope === FEATURE_FLAG_OVERRIDE_SCOPE.TENANT && doc.tenantId === tenantId
    );
    if (tenantDoc) return tenantDoc.enabled;
    const globalDoc = docs.find(
      (doc) => doc.scope === FEATURE_FLAG_OVERRIDE_SCOPE.GLOBAL
    );
    return globalDoc ? globalDoc.enabled : null;
  }
}

export class FeatureFlagEvaluator {
  private readonly ttlMs: number;
  private readonly overrideStore: FeatureFlagOverrideStore;
  private readonly registry: Record<string, FeatureFlagDefinition>;
  private readonly now: () => number;
  private readonly cache = new Map<string, CachedOverride>();

  constructor(options: FeatureFlagEvaluatorOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.overrideStore = options.overrideStore ?? new MongoOverrideStore();
    this.registry =
      options.registry ?? (FEATURE_FLAG_REGISTRY as Record<string, FeatureFlagDefinition>);
    this.now = options.now ?? (() => Date.now());
  }

  async isEnabled(
    flagName: FeatureFlagName,
    context: FeatureFlagContext
  ): Promise<boolean> {
    const definition = this.registry[flagName];
    if (!definition) {
      throw new Error(`Unknown feature flag: ${flagName}`);
    }
    const override = await this.resolveOverride(flagName, context.tenantId);
    if (override !== null) return override;
    return applyTargeting(definition, flagName, context);
  }

  async evaluateGlobal(flagName: FeatureFlagName): Promise<boolean> {
    const definition = this.registry[flagName];
    if (!definition) {
      throw new Error(`Unknown feature flag: ${flagName}`);
    }
    if (definition.targeting.length > 0) {
      throw new Error(
        `Cannot evaluate flag ${flagName} globally: it declares tenant targeting rules and requires a tenant context`
      );
    }
    return definition.defaultEnabled;
  }

  async evaluateAll(
    context: FeatureFlagContext
  ): Promise<Record<FeatureFlagName, boolean>> {
    const entries = await Promise.all(
      (Object.keys(this.registry) as FeatureFlagName[]).map(
        async (name) => [name, await this.isEnabled(name, context)] as const
      )
    );
    return Object.fromEntries(entries) as Record<FeatureFlagName, boolean>;
  }

  private async resolveOverride(
    flagName: string,
    tenantId: string
  ): Promise<boolean | null> {
    const cacheKey = `${flagName}::${tenantId}`;
    const cached = this.cache.get(cacheKey);
    const nowTs = this.now();
    if (cached && cached.expiresAt > nowTs) {
      return cached.enabled;
    }
    const value = await this.overrideStore.findOverride(flagName, tenantId);
    if (value === null) {
      this.cache.delete(cacheKey);
      return null;
    }
    this.cache.set(cacheKey, { enabled: value, expiresAt: nowTs + this.ttlMs });
    return value;
  }
}

let singleton: FeatureFlagEvaluator | null = null;

export function getFeatureFlagEvaluator(): FeatureFlagEvaluator {
  if (!singleton) singleton = new FeatureFlagEvaluator();
  return singleton;
}
