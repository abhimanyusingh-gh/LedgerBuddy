import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import type { WorkloadTier } from "../types/tenant.js";

type OcrProviderType = "auto" | "deepseek" | "mock";
type VerifierProviderType = "none" | "http";
type FileStoreProviderType = "local" | "s3";
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
  fileStore: {
    provider: FileStoreProviderType;
    local: {
      rootPath: string;
    };
    s3: {
      bucket: string;
      region: string;
      prefix: string;
      endpoint: string;
      forcePathStyle: boolean;
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
  fileStore: z
    .object({
      provider: z.enum(["local", "s3"]).optional(),
      local: z
        .object({
          rootPath: z.string().min(1).optional()
        })
        .optional(),
      s3: z
        .object({
          bucket: z.string().optional(),
          region: z.string().min(1).optional(),
          prefix: z.string().optional(),
          endpoint: z.string().optional(),
          forcePathStyle: z.coerce.boolean().optional()
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
          oauthUserId: z.string().min(1).optional(),
          transport: z.enum(["imap", "mailhog_oauth"]).optional(),
          mailhogApiBaseUrl: z.string().optional(),
          host: z.string().optional(),
          port: z.coerce.number().int().positive().optional(),
          secure: z.coerce.boolean().optional(),
          smtpHost: z.string().optional(),
          smtpPort: z.coerce.number().int().positive().optional(),
          smtpSecure: z.coerce.boolean().optional(),
          smtpTimeoutMs: z.coerce.number().int().positive().optional(),
          username: z.string().optional(),
          authMode: z.enum(["password", "oauth2"]).optional(),
          password: z.string().optional(),
          oauth2: z
            .object({
              clientId: z.string().optional(),
              clientSecret: z.string().optional(),
              refreshToken: z.string().optional(),
              accessToken: z.string().optional(),
              tokenEndpoint: z.string().optional()
            })
            .optional(),
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
  const manifestPath = resolveConfiguredManifestPath();
  if (!manifestPath) {
    return defaults;
  }

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
    fileStore: {
      provider: defaults.fileStore.provider,
      local: {
        rootPath: parsed.fileStore?.local?.rootPath ?? defaults.fileStore.local.rootPath
      },
      s3: {
        bucket: parsed.fileStore?.s3?.bucket ?? defaults.fileStore.s3.bucket,
        region: parsed.fileStore?.s3?.region ?? defaults.fileStore.s3.region,
        prefix: parsed.fileStore?.s3?.prefix ?? defaults.fileStore.s3.prefix,
        endpoint: parsed.fileStore?.s3?.endpoint ?? defaults.fileStore.s3.endpoint,
        forcePathStyle: parsed.fileStore?.s3?.forcePathStyle ?? defaults.fileStore.s3.forcePathStyle
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
    ocrProvider: merged.ocr.provider,
    fileStoreProvider: merged.fileStore.provider
  });

  return merged;
}

function resolveConfiguredManifestPath(): string | null {
  if (env.APP_MANIFEST_PATH && env.APP_MANIFEST_PATH.trim().length > 0) {
    return resolveManifestPath(env.APP_MANIFEST_PATH);
  }

  if (!env.isLocalMlEnv || env.NODE_ENV === "test") {
    return null;
  }

  const candidates = [
    path.resolve(process.cwd(), "backend/runtime-manifest.local.json"),
    path.resolve(process.cwd(), "runtime-manifest.local.json"),
    "/app/backend/runtime-manifest.local.json"
  ];

  const existingPath = candidates.find((candidatePath) => existsSync(candidatePath));
  return existingPath ?? null;
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
    fileStore: {
      provider: env.isLocalMlEnv ? "local" : "s3",
      local: {
        rootPath: env.LOCAL_FILE_STORE_ROOT
      },
      s3: {
        bucket: env.S3_FILE_STORE_BUCKET?.trim() ?? "",
        region: env.S3_FILE_STORE_REGION,
        prefix: env.S3_FILE_STORE_PREFIX,
        endpoint: env.S3_FILE_STORE_ENDPOINT?.trim() ?? "",
        forcePathStyle: env.S3_FILE_STORE_FORCE_PATH_STYLE
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
      oauthUserId: env.DEFAULT_USER_ID,
      transport: env.EMAIL_TRANSPORT,
      mailhogApiBaseUrl: env.EMAIL_MAILHOG_API_BASE_URL,
      host: env.EMAIL_HOST ?? "",
      port: env.EMAIL_PORT,
      secure: env.EMAIL_SECURE,
      smtpHost: env.EMAIL_SMTP_HOST,
      smtpPort: env.EMAIL_SMTP_PORT,
      smtpSecure: env.EMAIL_SMTP_SECURE,
      smtpTimeoutMs: env.EMAIL_SMTP_TIMEOUT_MS,
      username: env.EMAIL_USERNAME ?? "",
      authMode: env.EMAIL_AUTH_MODE,
      password: env.EMAIL_PASSWORD ?? "",
      oauth2: {
        clientId: env.EMAIL_OAUTH_CLIENT_ID ?? "",
        clientSecret: env.EMAIL_OAUTH_CLIENT_SECRET ?? "",
        refreshToken: env.EMAIL_OAUTH_REFRESH_TOKEN ?? "",
        accessToken: env.EMAIL_OAUTH_ACCESS_TOKEN ?? "",
        tokenEndpoint: env.EMAIL_OAUTH_TOKEN_ENDPOINT
      },
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
      oauthUserId: source.oauthUserId ?? env.DEFAULT_USER_ID,
      transport: source.transport ?? env.EMAIL_TRANSPORT,
      mailhogApiBaseUrl: source.mailhogApiBaseUrl ?? env.EMAIL_MAILHOG_API_BASE_URL,
      host: source.host ?? env.EMAIL_HOST ?? "",
      port: source.port ?? env.EMAIL_PORT,
      secure: source.secure ?? env.EMAIL_SECURE,
      smtpHost: source.smtpHost ?? env.EMAIL_SMTP_HOST,
      smtpPort: source.smtpPort ?? env.EMAIL_SMTP_PORT,
      smtpSecure: source.smtpSecure ?? env.EMAIL_SMTP_SECURE,
      smtpTimeoutMs: source.smtpTimeoutMs ?? env.EMAIL_SMTP_TIMEOUT_MS,
      username: source.username ?? env.EMAIL_USERNAME ?? "",
      authMode: source.authMode ?? env.EMAIL_AUTH_MODE,
      password: source.password ?? env.EMAIL_PASSWORD ?? "",
      oauth2: {
        clientId: source.oauth2?.clientId ?? env.EMAIL_OAUTH_CLIENT_ID ?? "",
        clientSecret: source.oauth2?.clientSecret ?? env.EMAIL_OAUTH_CLIENT_SECRET ?? "",
        refreshToken: source.oauth2?.refreshToken ?? env.EMAIL_OAUTH_REFRESH_TOKEN ?? "",
        accessToken: source.oauth2?.accessToken ?? env.EMAIL_OAUTH_ACCESS_TOKEN ?? "",
        tokenEndpoint: source.oauth2?.tokenEndpoint ?? env.EMAIL_OAUTH_TOKEN_ENDPOINT
      },
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
