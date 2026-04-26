import { existsSync } from "node:fs";
import path from "node:path";
import { env } from "@/config/env.js";
import type { WorkloadTier } from "@/types/tenant.js";
import type { IngestionSourceManifest, RuntimeManifest } from "@/core/runtimeManifest.js";
import type { RuntimeSourceInput } from "@/core/runtimeManifestSchema.js";
import { type UUID, toUUID } from "@/types/uuid.js";

export function deepMerge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(base)) {
    const ov = overrides[key];
    if (ov === undefined || ov === null) continue;
    if (typeof ov === "object" && !Array.isArray(ov) && typeof base[key] === "object" && !Array.isArray(base[key])) {
      result[key] = deepMerge(base[key] as Record<string, unknown>, ov as Record<string, unknown>);
    } else {
      result[key] = ov;
    }
  }
  return result;
}

export function createDefaultManifest(defaultTenantId: UUID, defaultWorkloadTier: WorkloadTier): RuntimeManifest {
  return {
    defaultTenantId,
    defaultWorkloadTier,
    database: { provider: "mongo", uri: env.MONGO_URI },
    sources: env.ingestionSources.map((type) =>
      resolveSource({ type } as RuntimeSourceInput, defaultTenantId, defaultWorkloadTier)
    ),
    ocr: {
      provider: env.OCR_PROVIDER,
      configuration: {
        baseUrl: env.OCR_PROVIDER_BASE_URL,
        apiKey: env.OCR_PROVIDER_API_KEY?.trim() ?? "",
        model: env.OCR_MODEL,
        timeoutMs: env.OCR_TIMEOUT_MS
      },
      mock: { text: env.MOCK_OCR_TEXT ?? "", confidence: env.MOCK_OCR_CONFIDENCE },
      llamaparse: {
        apiKey: env.LLAMA_CLOUD_API_KEY?.trim() ?? "",
        tier: env.LLAMA_PARSE_TIER,
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
      provider: "s3",
      configuration: {
        bucket: env.S3_FILE_STORE_BUCKET,
        region: env.S3_FILE_STORE_REGION,
        prefix: env.S3_FILE_STORE_PREFIX,
        endpoint: env.S3_FILE_STORE_ENDPOINT,
        publicEndpoint: env.S3_FILE_STORE_PUBLIC_ENDPOINT,
        forcePathStyle: env.S3_FILE_STORE_FORCE_PATH_STYLE
      }
    },
    export: {
      tallyEndpoint: env.TALLY_ENDPOINT ?? "",
      tallyCompany: env.TALLY_COMPANY ?? "",
      tallyPurchaseLedger: env.TALLY_PURCHASE_LEDGER,
      tallyGstLedgers: {
        cgstLedger: env.TALLY_CGST_LEDGER,
        sgstLedger: env.TALLY_SGST_LEDGER,
        igstLedger: env.TALLY_IGST_LEDGER,
        cessLedger: env.TALLY_CESS_LEDGER
      }
    }
  };
}

export function resolveSource(
  source: RuntimeSourceInput,
  defaultTenantId: UUID,
  defaultWorkloadTier: WorkloadTier
): IngestionSourceManifest {
  if (source.type === "email") {
    const resolvedTenantId = source.tenantId ? toUUID(source.tenantId) : defaultTenantId;
    return {
      type: "email",
      key: source.key ?? env.EMAIL_SOURCE_KEY,
      tenantId: resolvedTenantId,
      workloadTier: source.workloadTier ?? defaultWorkloadTier,
      oauthUserId: source.oauthUserId ?? source.tenantId ?? defaultTenantId,
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

  throw new Error(`Unsupported ingestion source '${(source as { type: string }).type}'.`);
}

export function resolveRuntimeManifestPath(): string | null {
  if (env.APP_MANIFEST_PATH?.trim()) {
    const trimmed = env.APP_MANIFEST_PATH.trim();
    return path.isAbsolute(trimmed) ? trimmed : path.resolve(process.cwd(), trimmed);
  }
  if (!env.isLocalMlEnv || env.NODE_ENV === "test") return null;
  return (
    [
      path.resolve(process.cwd(), "backend/runtime-manifest.local.json"),
      path.resolve(process.cwd(), "runtime-manifest.local.json"),
      "/app/backend/runtime-manifest.local.json"
    ].find((p) => existsSync(p)) ?? null
  );
}
