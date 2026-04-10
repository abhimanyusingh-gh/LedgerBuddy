import { readFileSync } from "node:fs";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { WorkloadTier } from "../types/tenant.js";
import { createDefaultManifest, deepMerge, resolveRuntimeManifestPath, resolveSource } from "./runtimeManifestConfig.js";
import { runtimeManifestSchema, type RuntimeManifestInput, type RuntimeSourceInput } from "./runtimeManifestSchema.js";

type OcrProviderType = "auto" | "deepseek" | "mock" | "llamaparse";
type VerifierProviderType = "none" | "http";
type FileStoreProviderType = "s3";
type SourceType = "email" | "folder";

interface SourceBaseManifest {
  type: SourceType;
  key: string;
  tenantId: string;
  workloadTier: WorkloadTier;
}

export interface EmailSourceManifest extends SourceBaseManifest {
  type: "email";
  oauthUserId: string;
  transport: "imap" | "mailhog_oauth";
  mailhogApiBaseUrl: string;
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpTimeoutMs: number;
  username: string;
  authMode: "password" | "oauth2";
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

export interface FolderSourceManifest extends SourceBaseManifest {
  type: "folder";
  folderPath: string;
  recursive: boolean;
}

export type IngestionSourceManifest = EmailSourceManifest | FolderSourceManifest;

export interface RuntimeManifest {
  defaultTenantId: string;
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
      tier: string;
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
      forcePathStyle: boolean;
    };
  };
  extraction: {
    ocrHighConfidenceThreshold: number;
    llmAssistConfidenceThreshold: number;
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
  const defaultTenantId = env.DEFAULT_TENANT_ID;
  const defaultWorkloadTier = env.DEFAULT_WORKLOAD_TIER;
  const defaults = createDefaultManifest(defaultTenantId, defaultWorkloadTier);
  const manifestPath = resolveRuntimeManifestPath();

  if (!manifestPath) return defaults;

  const parsed: RuntimeManifestInput = runtimeManifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf-8")));
  const resolvedDefaultTenantId = parsed.defaultTenantId ?? defaults.defaultTenantId;
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
    extraction: {
      ocrHighConfidenceThreshold: parsed.extraction?.ocrHighConfidenceThreshold,
      llmAssistConfidenceThreshold: parsed.extraction?.llmAssistConfidenceThreshold
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
