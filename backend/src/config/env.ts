import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const APP_ENVIRONMENTS = ["local", "dev", "stg", "prod"] as const;
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

function resolveRuntimeEnvironment(value: string | undefined): AppEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "local" || normalized === "dev" || normalized === "stg" || normalized === "prod") {
    return normalized;
  }
  return "local";
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isLocalMlEnvironment(environment: AppEnvironment): boolean {
  return environment === "local" || environment === "dev";
}

const runtimeEnv = resolveRuntimeEnvironment(process.env.ENV);

const envSchema = z.object({
  ENV: z.enum(APP_ENVIRONMENTS).default(runtimeEnv),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGO_URI: z.string().min(1),
  APP_MANIFEST_PATH: z.string().optional(),

  INGESTION_SOURCES: z.string().default("email"),
  DEFAULT_TENANT_ID: z.string().default("default"),
  DEFAULT_WORKLOAD_TIER: z.enum(["standard", "heavy"]).default("standard"),

  EMAIL_SOURCE_KEY: z.string().default("email-inbox"),
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().default(993),
  EMAIL_SECURE: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  EMAIL_USERNAME: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_TRANSPORT: z.enum(["imap", "mailhog_oauth"]).default("imap"),
  EMAIL_MAILHOG_API_BASE_URL: z
    .string()
    .default("http://mailhog-oauth:8026")
    .transform((value) => normalizeUrl(value)),
  EMAIL_AUTH_MODE: z.enum(["password", "oauth2"]).default("password"),
  EMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  EMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  EMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
  EMAIL_OAUTH_ACCESS_TOKEN: z.string().optional(),
  EMAIL_OAUTH_TOKEN_ENDPOINT: z
    .string()
    .default("https://oauth2.googleapis.com/token")
    .transform((value) => normalizeUrl(value)),
  EMAIL_SIMULATION_SAMPLE_DIR: z.string().default(""),
  EMAIL_MAILBOX: z.string().default("INBOX"),
  EMAIL_FROM_FILTER: z.string().optional(),

  FOLDER_SOURCE_KEY: z.string().default("folder-local"),
  FOLDER_SOURCE_PATH: z.string().optional(),
  FOLDER_RECURSIVE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  OCR_PROVIDER: z.enum(["auto", "deepseek", "mock"]).default("auto"),
  DEEPSEEK_API_KEY: z.string().optional(),
  DEEPSEEK_BASE_URL: z.string().optional(),
  DEEPSEEK_OCR_MODEL: z.string().default("mlx-community/DeepSeek-OCR-4bit"),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().default(3600000),
  MOCK_OCR_TEXT: z.string().optional(),
  MOCK_OCR_CONFIDENCE: z.coerce.number().optional(),
  OCR_HIGH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.88),

  FIELD_VERIFIER_PROVIDER: z.enum(["none", "http"]).default("http"),
  FIELD_VERIFIER_BASE_URL: z.string().optional(),
  FIELD_VERIFIER_TIMEOUT_MS: z.coerce.number().default(20000),
  FIELD_VERIFIER_API_KEY: z.string().optional(),

  LOCAL_FILE_STORE_ROOT: z.string().default(".local-run/artifacts"),
  S3_FILE_STORE_BUCKET: z.string().optional(),
  S3_FILE_STORE_REGION: z.string().default("us-east-1"),
  S3_FILE_STORE_PREFIX: z.string().default("invoice-processor"),
  S3_FILE_STORE_ENDPOINT: z.string().optional(),
  S3_FILE_STORE_FORCE_PATH_STYLE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  CONFIDENCE_EXPECTED_MAX_TOTAL: z.coerce.number().default(100000),
  CONFIDENCE_EXPECTED_MAX_DUE_DAYS: z.coerce.number().default(90),
  CONFIDENCE_AUTO_SELECT_MIN: z.coerce.number().default(91),

  TALLY_ENDPOINT: z.string().optional(),
  TALLY_COMPANY: z.string().optional(),
  TALLY_PURCHASE_LEDGER: z.string().default("Purchase"),
  DEFAULT_APPROVER: z.string().default("system")
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid env vars", parsed.error.format());
  process.exit(1);
}

const values = parsed.data;
const localMlEnv = isLocalMlEnvironment(values.ENV);

const resolvedOcrBaseUrl = normalizeUrl(
  values.DEEPSEEK_BASE_URL ?? (localMlEnv ? "http://localhost:8000/v1" : "")
);
const resolvedSlmBaseUrl = normalizeUrl(
  values.FIELD_VERIFIER_BASE_URL ?? (localMlEnv ? "http://localhost:8100/v1" : "")
);

if (!localMlEnv) {
  if (resolvedOcrBaseUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.error("Invalid env vars: DEEPSEEK_BASE_URL is required when ENV is 'stg' or 'prod'.");
    process.exit(1);
  }

  if (values.FIELD_VERIFIER_PROVIDER === "http" && resolvedSlmBaseUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.error("Invalid env vars: FIELD_VERIFIER_BASE_URL is required when ENV is 'stg' or 'prod'.");
    process.exit(1);
  }
}

export const env = {
  ...values,
  DEEPSEEK_BASE_URL: resolvedOcrBaseUrl,
  FIELD_VERIFIER_BASE_URL: resolvedSlmBaseUrl,
  isLocalMlEnv: localMlEnv,
  ingestionSources: values.INGESTION_SOURCES.split(",")
    .map((source) => source.trim())
    .filter(Boolean)
};
