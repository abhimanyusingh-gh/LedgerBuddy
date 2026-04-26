import { readFileSync } from "node:fs";
import { env } from "@/config/env.js";
import { logger } from "@/utils/logger.js";
import type { WorkloadTier } from "@/types/tenant.js";
import { createDefaultManifest, deepMerge, resolveRuntimeManifestPath, resolveSource } from "@/core/runtimeManifestConfig.js";
import { runtimeManifestSchema, type RuntimeManifestInput, type RuntimeSourceInput } from "@/core/runtimeManifestSchema.js";
import { type UUID, toUUID } from "@/types/uuid.js";

import type { IngestionSourceType } from "@/core/interfaces/IngestionSource.js";
import type { EmailTransportType, EmailAuthMode } from "@/types/email.js";

type OcrProviderType = "auto" | "deepseek" | "mock" | "llamaparse";
type VerifierProviderType = "none" | "http";
type FileStoreProviderType = "s3";
type SourceType = Extract<IngestionSourceType, "email">;

export const LLAMA_PARSE_TIER = {
  FAST: "fast",
  COST_EFFECTIVE: "cost_effective",
  AGENTIC: "agentic",
} as const;

export type LlamaParseTier = (typeof LLAMA_PARSE_TIER)[keyof typeof LLAMA_PARSE_TIER];


interface SourceBaseManifest {
  type: SourceType;
  key: string;
  tenantId: UUID;
  workloadTier: WorkloadTier;
}

export interface EmailSourceManifest extends SourceBaseManifest {
  type: "email";
  oauthUserId: string;
  transport: EmailTransportType;
  mailhogApiBaseUrl: string;
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpTimeoutMs: number;
  username: string;
  authMode: EmailAuthMode;
  password: string;
  oauth2: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    accessToken: string;
    tokenEndpoint: string;
  };
  mailbox: string;
  fromFilter: string;
}

export type IngestionSourceManifest = EmailSourceManifest;

export interface RuntimeManifest {
  defaultTenantId: UUID;
  defaultWorkloadTier: WorkloadTier;
  sources: IngestionSourceManifest[];
  database: {
    provider: "mongo";
    uri: string;
  };
  ocr: {
    provider: OcrProviderType;
    configuration: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs: number;
    };
    mock: {
      text: string;
      confidence: number | undefined;
    };
    llamaparse: {
      apiKey: string;
      tier: LlamaParseTier;
    };
  };
  verifier: {
    provider: VerifierProviderType;
    http: {
      baseUrl: string;
      timeoutMs: number;
      apiKey: string;
    };
  };
  fileStore: {
    provider: FileStoreProviderType;
    configuration: {
      bucket: string;
      region: string;
      prefix: string;
      endpoint: string;
      publicEndpoint: string;
      forcePathStyle: boolean;
    };
  };
  export: {
    tallyEndpoint: string;
    tallyCompany: string;
    tallyPurchaseLedger: string;
    tallyGstLedgers: {
      cgstLedger: string;
      sgstLedger: string;
      igstLedger: string;
      cessLedger: string;
    };
  };
}

export function loadRuntimeManifest(): RuntimeManifest {
  const defaultTenantId = toUUID(env.DEFAULT_TENANT_ID);
  const defaultWorkloadTier = env.DEFAULT_WORKLOAD_TIER;
  const defaults = createDefaultManifest(defaultTenantId, defaultWorkloadTier);
  const manifestPath = resolveRuntimeManifestPath();

  if (!manifestPath) return defaults;

  const parsed: RuntimeManifestInput = runtimeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf-8")));
  const resolvedDefaultTenantId = parsed.defaultTenantId ? toUUID(parsed.defaultTenantId) : defaults.defaultTenantId;
  const resolvedDefaultWorkloadTier = parsed.defaultWorkloadTier ?? defaults.defaultWorkloadTier;

  const merged = deepMerge(defaults as unknown as Record<string, unknown>, {
    defaultTenantId: resolvedDefaultTenantId,
    defaultWorkloadTier: resolvedDefaultWorkloadTier,
    database: { uri: parsed.database?.uri },
    ocr: {
      provider: parsed.ocr?.provider,
      configuration: parsed.ocr?.deepseek,
      mock: parsed.ocr?.mock,
      llamaparse: parsed.ocr?.llamaparse
    },
    verifier: {
      provider: parsed.verifier?.provider,
      http: parsed.verifier?.http
    },
    fileStore: {
      configuration: parsed.fileStore?.s3
    },
    export: {
      tallyEndpoint: parsed.export?.tallyEndpoint,
      tallyCompany: parsed.export?.tallyCompany,
      tallyPurchaseLedger: parsed.export?.tallyPurchaseLedger,
      tallyGstLedgers: parsed.export?.tallyGstLedgers
    },
    sources: parsed.sources?.map((entry: RuntimeSourceInput) =>
      resolveSource(entry, resolvedDefaultTenantId, resolvedDefaultWorkloadTier)
    )
  }) as unknown as RuntimeManifest;

  logger.info("runtime.manifest.loaded", {
    path: manifestPath,
    sourceCount: merged.sources.length,
    ocrProvider: merged.ocr.provider,
    fileStoreProvider: merged.fileStore.provider
  });

  return merged;
}
