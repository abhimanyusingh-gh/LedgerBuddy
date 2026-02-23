import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { WorkloadTier } from "../types/tenant.js";

type OcrProviderType = "auto" | "deepseek" | "mock";
type VerifierProviderType = "none" | "http";
type SourceType = "email" | "folder";

interface SourceBaseManifest {
  type: SourceType;
  key: string;
  tenantId: string;
  workloadTier: WorkloadTier;
}

export interface EmailSourceManifest extends SourceBaseManifest {
  type: "email";
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
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
    deepseek: {
      baseUrl: string;
      apiKey: string;
      model: string;
      timeoutMs: number;
    };
    mock: {
      text: string;
      confidence: number | undefined;
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
  extraction: {
    ocrHighConfidenceThreshold: number;
  };
  export: {
    tallyEndpoint: string;
    tallyCompany: string;
    tallyPurchaseLedger: string;
  };
}

const runtimeManifestSchema = z.object({
  defaultTenantId: z.string().min(1).optional(),
  defaultWorkloadTier: z.enum(["standard", "heavy"]).optional(),
  ocr: z
    .object({
      provider: z.enum(["auto", "deepseek", "mock"]).optional(),
      deepseek: z
        .object({
          baseUrl: z.string().min(1).optional(),
          apiKey: z.string().optional(),
          model: z.string().min(1).optional(),
          timeoutMs: z.coerce.number().int().positive().optional()
        })
        .optional(),
      mock: z
        .object({
          text: z.string().optional(),
          confidence: z.coerce.number().min(0).max(1).optional()
        })
        .optional()
    })
    .optional(),
  verifier: z
    .object({
      provider: z.enum(["none", "http"]).optional(),
      http: z
        .object({
          baseUrl: z.string().min(1).optional(),
          timeoutMs: z.coerce.number().int().positive().optional(),
          apiKey: z.string().optional()
        })
        .optional()
    })
    .optional(),
  extraction: z
    .object({
      ocrHighConfidenceThreshold: z.coerce.number().min(0).max(1).optional()
    })
    .optional(),
  database: z
    .object({
      provider: z.literal("mongo").optional(),
      uri: z.string().min(1).optional()
    })
    .optional(),
  export: z
    .object({
      tallyEndpoint: z.string().optional(),
      tallyCompany: z.string().optional(),
      tallyPurchaseLedger: z.string().optional()
    })
    .optional(),
  sources: z
    .array(
      z.discriminatedUnion("type", [
        z.object({
          type: z.literal("email"),
          key: z.string().min(1).optional(),
          tenantId: z.string().min(1).optional(),
          workloadTier: z.enum(["standard", "heavy"]).optional(),
          host: z.string().optional(),
          port: z.coerce.number().int().positive().optional(),
          secure: z.coerce.boolean().optional(),
          username: z.string().optional(),
          password: z.string().optional(),
          mailbox: z.string().optional(),
          fromFilter: z.string().optional()
        }),
        z.object({
          type: z.literal("folder"),
          key: z.string().min(1).optional(),
          tenantId: z.string().min(1).optional(),
          workloadTier: z.enum(["standard", "heavy"]).optional(),
          folderPath: z.string().optional(),
          recursive: z.coerce.boolean().optional()
        })
      ])
    )
    .optional()
});

type RuntimeManifestInput = z.infer<typeof runtimeManifestSchema>;
type RuntimeSourceInput = NonNullable<RuntimeManifestInput["sources"]>[number];

export function loadRuntimeManifest(): RuntimeManifest {
  const defaults = createDefaultManifest();
  if (!env.APP_MANIFEST_PATH || env.APP_MANIFEST_PATH.trim().length === 0) {
    return defaults;
  }

  const manifestPath = resolveManifestPath(env.APP_MANIFEST_PATH);
  const fileBody = readFileSync(manifestPath, "utf-8");
  const parsed = runtimeManifestSchema.parse(JSON.parse(fileBody));

  const defaultTenantId = parsed.defaultTenantId ?? defaults.defaultTenantId;
  const defaultWorkloadTier = parsed.defaultWorkloadTier ?? defaults.defaultWorkloadTier;
  const merged: RuntimeManifest = {
    defaultTenantId,
    defaultWorkloadTier,
    database: {
      provider: "mongo",
      uri: parsed.database?.uri ?? defaults.database.uri
    },
    ocr: {
      provider: parsed.ocr?.provider ?? defaults.ocr.provider,
      deepseek: {
        baseUrl: parsed.ocr?.deepseek?.baseUrl ?? defaults.ocr.deepseek.baseUrl,
        apiKey: parsed.ocr?.deepseek?.apiKey ?? defaults.ocr.deepseek.apiKey,
        model: parsed.ocr?.deepseek?.model ?? defaults.ocr.deepseek.model,
        timeoutMs: parsed.ocr?.deepseek?.timeoutMs ?? defaults.ocr.deepseek.timeoutMs
      },
      mock: {
        text: parsed.ocr?.mock?.text ?? defaults.ocr.mock.text,
        confidence: parsed.ocr?.mock?.confidence ?? defaults.ocr.mock.confidence
      }
    },
    verifier: {
      provider: parsed.verifier?.provider ?? defaults.verifier.provider,
      http: {
        baseUrl: parsed.verifier?.http?.baseUrl ?? defaults.verifier.http.baseUrl,
        timeoutMs: parsed.verifier?.http?.timeoutMs ?? defaults.verifier.http.timeoutMs,
        apiKey: parsed.verifier?.http?.apiKey ?? defaults.verifier.http.apiKey
      }
    },
    extraction: {
      ocrHighConfidenceThreshold:
        parsed.extraction?.ocrHighConfidenceThreshold ?? defaults.extraction.ocrHighConfidenceThreshold
    },
    export: {
      tallyEndpoint: parsed.export?.tallyEndpoint ?? defaults.export.tallyEndpoint,
      tallyCompany: parsed.export?.tallyCompany ?? defaults.export.tallyCompany,
      tallyPurchaseLedger: parsed.export?.tallyPurchaseLedger ?? defaults.export.tallyPurchaseLedger
    },
    sources:
      parsed.sources?.map((entry) =>
        resolveManifestSource(entry, {
          defaultTenantId,
          defaultWorkloadTier
        })
      ) ?? defaults.sources
  };

  logger.info("runtime.manifest.loaded", {
    path: manifestPath,
    sourceCount: merged.sources.length,
    ocrProvider: merged.ocr.provider
  });

  return merged;
}

function createDefaultManifest(): RuntimeManifest {
  const defaultTenantId = env.DEFAULT_TENANT_ID;
  const defaultWorkloadTier = env.DEFAULT_WORKLOAD_TIER;

  return {
    defaultTenantId,
    defaultWorkloadTier,
    database: {
      provider: "mongo",
      uri: env.MONGO_URI
    },
    sources: env.ingestionSources.map((type) =>
      resolveEnvSource(type, {
        defaultTenantId,
        defaultWorkloadTier
      })
    ),
    ocr: {
      provider: env.OCR_PROVIDER,
      deepseek: {
        baseUrl: env.DEEPSEEK_BASE_URL,
        apiKey: env.DEEPSEEK_API_KEY?.trim() ?? "",
        model: env.DEEPSEEK_OCR_MODEL,
        timeoutMs: env.DEEPSEEK_TIMEOUT_MS
      },
      mock: {
        text: env.MOCK_OCR_TEXT ?? "",
        confidence: env.MOCK_OCR_CONFIDENCE
      }
    },
    verifier: {
      provider: env.FIELD_VERIFIER_PROVIDER,
      http: {
        baseUrl: env.FIELD_VERIFIER_BASE_URL,
        timeoutMs: env.FIELD_VERIFIER_TIMEOUT_MS,
        apiKey: env.FIELD_VERIFIER_API_KEY?.trim() ?? ""
      }
    },
    extraction: {
      ocrHighConfidenceThreshold: env.OCR_HIGH_CONFIDENCE_THRESHOLD
    },
    export: {
      tallyEndpoint: env.TALLY_ENDPOINT ?? "",
      tallyCompany: env.TALLY_COMPANY ?? "",
      tallyPurchaseLedger: env.TALLY_PURCHASE_LEDGER
    }
  };
}

function resolveEnvSource(
  sourceType: string,
  defaults: {
    defaultTenantId: string;
    defaultWorkloadTier: WorkloadTier;
  }
): IngestionSourceManifest {
  if (sourceType === "email") {
    return {
      type: "email",
      key: env.EMAIL_SOURCE_KEY,
      tenantId: defaults.defaultTenantId,
      workloadTier: defaults.defaultWorkloadTier,
      host: env.EMAIL_HOST ?? "",
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE,
      username: env.EMAIL_USERNAME ?? "",
      password: env.EMAIL_PASSWORD ?? "",
      mailbox: env.EMAIL_MAILBOX,
      fromFilter: env.EMAIL_FROM_FILTER ?? ""
    };
  }

  if (sourceType === "folder") {
    return {
      type: "folder",
      key: env.FOLDER_SOURCE_KEY,
      tenantId: defaults.defaultTenantId,
      workloadTier: defaults.defaultWorkloadTier,
      folderPath: env.FOLDER_SOURCE_PATH ?? "",
      recursive: env.FOLDER_RECURSIVE
    };
  }

  throw new Error(`Unsupported ingestion source '${sourceType}'. Add an IngestionSource implementation to support it.`);
}

function resolveManifestSource(
  source: RuntimeSourceInput,
  defaults: {
    defaultTenantId: string;
    defaultWorkloadTier: WorkloadTier;
  }
): IngestionSourceManifest {
  if (source.type === "email") {
    return {
      type: "email",
      key: source.key ?? env.EMAIL_SOURCE_KEY,
      tenantId: source.tenantId ?? defaults.defaultTenantId,
      workloadTier: source.workloadTier ?? defaults.defaultWorkloadTier,
      host: source.host ?? env.EMAIL_HOST ?? "",
      port: source.port ?? env.EMAIL_PORT,
      secure: source.secure ?? env.EMAIL_SECURE,
      username: source.username ?? env.EMAIL_USERNAME ?? "",
      password: source.password ?? env.EMAIL_PASSWORD ?? "",
      mailbox: source.mailbox ?? env.EMAIL_MAILBOX,
      fromFilter: source.fromFilter ?? env.EMAIL_FROM_FILTER ?? ""
    };
  }

  return {
    type: "folder",
    key: source.key ?? env.FOLDER_SOURCE_KEY,
    tenantId: source.tenantId ?? defaults.defaultTenantId,
    workloadTier: source.workloadTier ?? defaults.defaultWorkloadTier,
    folderPath: source.folderPath ?? env.FOLDER_SOURCE_PATH ?? "",
    recursive: source.recursive ?? env.FOLDER_RECURSIVE
  };
}

function resolveManifestPath(rawPath: string): string {
  const trimmedPath = rawPath.trim();
  if (path.isAbsolute(trimmedPath)) {
    return trimmedPath;
  }

  return path.resolve(process.cwd(), trimmedPath);
}
