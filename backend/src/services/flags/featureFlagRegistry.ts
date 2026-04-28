export const FEATURE_FLAG_TARGETING_KIND = {
  TENANT_ALLOWLIST: "tenantAllowlist",
  TENANT_DENYLIST: "tenantDenylist",
  PERCENTAGE_ROLLOUT: "percentageRollout"
} as const;

export type FeatureFlagTargetingRule =
  | { kind: typeof FEATURE_FLAG_TARGETING_KIND.TENANT_ALLOWLIST; tenantIds: readonly string[] }
  | { kind: typeof FEATURE_FLAG_TARGETING_KIND.TENANT_DENYLIST; tenantIds: readonly string[] }
  | { kind: typeof FEATURE_FLAG_TARGETING_KIND.PERCENTAGE_ROLLOUT; percentage: number };

export interface FeatureFlagDefinition {
  readonly description: string;
  readonly defaultEnabled: boolean;
  readonly targeting: readonly FeatureFlagTargetingRule[];
}

export const FEATURE_FLAG_REGISTRY = {
  "example.healthCheckVerbose": {
    description:
      "Emit the full per-dependency health payload in the logger output when the /health endpoint is hit. Canary consumer for INFRA-2.",
    defaultEnabled: false,
    targeting: []
  },
  "tds.cumulativeEnabled": {
    description:
      "Gate the TDS cumulative threshold tracking pipeline (TdsVendorLedger model + service). Off in prod until Phase 1 sign-off (#255).",
    defaultEnabled: false,
    targeting: []
  }
} as const satisfies Record<string, FeatureFlagDefinition>;

export const TDS_CUMULATIVE_ENABLED_FLAG = "tds.cumulativeEnabled" satisfies FeatureFlagName;

export type FeatureFlagName = keyof typeof FEATURE_FLAG_REGISTRY;
