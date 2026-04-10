import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const APP_ENVIRONMENTS = ["local", "stg", "prod"] as const;
type AppEnvironment = (typeof APP_ENVIRONMENTS)[number];

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isLocalMlEnvironment(environment: AppEnvironment): boolean {
  return environment === "local";
}

const envSchema = z.object({
  ENV: z.enum(APP_ENVIRONMENTS),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  API_BASE_URL: z.string().default("http://localhost:4100"),
  MONGO_URI: z.string().min(1),
  APP_MANIFEST_PATH: z.string().optional(),
  FRONTEND_BASE_URL: z.string().default("http://localhost:5177"),

  OIDC_CLIENT_ID: z.string().default("billforge-app"),
  OIDC_CLIENT_SECRET: z.string().default("billforge-local-secret"),
  OIDC_SCOPES: z.string().default("openid profile email offline_access"),
  OIDC_REDIRECT_URI: z
    .string()
    .default("http://localhost:4100/api/auth/callback")
    .transform((value) => normalizeUrl(value)),
  OIDC_AUTH_URL: z
    .string()
    .default("http://localhost:8280/realms/billforge/protocol/openid-connect/auth")
    .transform((value) => normalizeUrl(value)),
  OIDC_TOKEN_URL: z
    .string()
    .default("http://keycloak:8080/realms/billforge/protocol/openid-connect/token")
    .transform((value) => normalizeUrl(value)),
  OIDC_VALIDATE_URL: z
    .string()
    .default("http://keycloak:8080/realms/billforge/protocol/openid-connect/token/introspect")
    .transform((value) => normalizeUrl(value)),
  OIDC_USERINFO_URL: z
    .string()
    .default("http://keycloak:8080/realms/billforge/protocol/openid-connect/userinfo")
    .transform((value) => normalizeUrl(value)),
  KEYCLOAK_INTERNAL_BASE_URL: z.string().default("http://keycloak:8080"),
  KEYCLOAK_REALM: z.string().default("billforge"),
  AUTH_STATE_TTL_SECONDS: z.coerce.number().default(600),
  APP_SESSION_SIGNING_SECRET: z.string().default("local-dev-session-signing-secret-change-me"),
  APP_SESSION_TTL_SECONDS: z.coerce.number().default(28800),
  REFRESH_TOKEN_ENCRYPTION_SECRET: z.string().default("local-dev-refresh-token-secret-32-chars"),
  AUTH_AUTO_PROVISION_USERS: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  PLATFORM_ADMIN_EMAILS: z.string().default(""),
  PLATFORM_ADMIN_SEED_PASSWORD: z.string().optional(),
  LOCAL_DEMO_SEED: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  LOCAL_DEMO_CONFIG_PATH: z.string().default("config/local-demo-users.json"),

  INGESTION_SOURCES: z.string().default("email"),
  INGESTION_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  DEFAULT_USER_ID: z.string().default("local-user"),
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
  EMAIL_SMTP_HOST: z.string().default("smtp.gmail.com"),
  EMAIL_SMTP_PORT: z.coerce.number().default(465),
  EMAIL_SMTP_SECURE: z
    .string()
    .default("true")
    .transform((value) => value === "true"),
  EMAIL_SMTP_TIMEOUT_MS: z.coerce.number().default(15000),
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
  GMAIL_OAUTH_CLIENT_ID: z.string().default(""),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().default(""),
  GMAIL_OAUTH_REDIRECT_URI: z
    .string()
    .default("http://localhost:4100/api/connect/gmail/callback")
    .transform((value) => normalizeUrl(value)),
  GMAIL_OAUTH_AUTH_URL: z
    .string()
    .default("https://accounts.google.com/o/oauth2/v2/auth")
    .transform((value) => normalizeUrl(value)),
  GMAIL_OAUTH_TOKEN_URL: z
    .string()
    .default("https://oauth2.googleapis.com/token")
    .transform((value) => normalizeUrl(value)),
  GMAIL_OAUTH_USERINFO_URL: z
    .string()
    .default("https://openidconnect.googleapis.com/v1/userinfo")
    .transform((value) => normalizeUrl(value)),
  GMAIL_OAUTH_SCOPES: z.string().default("https://mail.google.com/ openid email profile"),
  GMAIL_OAUTH_STATE_TTL_SECONDS: z.coerce.number().default(600),
  GMAIL_OAUTH_HTTP_TIMEOUT_MS: z.coerce.number().default(15000),
  GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET: z.string().default("local-dev-gmail-oauth-encryption-secret"),
  GMAIL_OAUTH_SUCCESS_REDIRECT_URL: z.string().default("http://localhost:5177"),
  GMAIL_OAUTH_FAILURE_REDIRECT_URL: z.string().default("http://localhost:5177"),
  EMAIL_MAILBOX: z.string().default("INBOX"),
  EMAIL_FROM_FILTER: z.string().optional(),

  FOLDER_SOURCE_KEY: z.string().default("folder-local"),
  FOLDER_SOURCE_PATH: z.string().optional(),
  FOLDER_RECURSIVE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),

  OCR_PROVIDER: z.enum(["auto", "deepseek", "mock", "llamaparse"]).default("auto"),
  OCR_PROVIDER_API_KEY: z.string().optional(),
  OCR_PROVIDER_BASE_URL: z.string().optional(),
  OCR_MODEL: z.string().default("mlx-community/DeepSeek-OCR-4bit"),
  OCR_TIMEOUT_MS: z.coerce.number().default(3600000),
  MOCK_OCR_TEXT: z.string().optional(),
  MOCK_OCR_CONFIDENCE: z.coerce.number().optional(),
  LLAMA_CLOUD_API_KEY: z.string().optional(),
  LLAMA_PARSE_TIER: z.enum(["fast", "cost_effective", "agentic", "agentic_plus"]).default("cost_effective"),
  OCR_HIGH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.88),

  FIELD_VERIFIER_PROVIDER: z.enum(["none", "http"]).default("http"),
  FIELD_VERIFIER_BASE_URL: z.string().optional(),
  FIELD_VERIFIER_TIMEOUT_MS: z.coerce.number().default(600000),
  FIELD_VERIFIER_API_KEY: z.string().optional(),

  S3_FILE_STORE_BUCKET: z.string().default("billforge-local"),
  S3_FILE_STORE_REGION: z.string().default("us-east-1"),
  S3_FILE_STORE_PREFIX: z.string().default("billforge"),
  S3_FILE_STORE_ENDPOINT: z.string().default("http://minio:9000"),
  S3_FILE_STORE_FORCE_PATH_STYLE: z
    .string()
    .default("true")
    .transform((value) => value === "true"),

  CONFIDENCE_EXPECTED_MAX_TOTAL: z.coerce.number().default(100000),
  CONFIDENCE_EXPECTED_MAX_DUE_DAYS: z.coerce.number().default(90),
  CONFIDENCE_AUTO_SELECT_MIN: z.coerce.number().default(91),
  LLM_ASSIST_CONFIDENCE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(85),
  LEARNING_MODE: z.enum(["active", "assistive"]).default("assistive"),

  TALLY_ENDPOINT: z.string().optional(),
  TALLY_COMPANY: z.string().optional(),
  TALLY_PURCHASE_LEDGER: z.string().default("Purchase"),
  TALLY_CGST_LEDGER: z.string().default("Input CGST"),
  TALLY_SGST_LEDGER: z.string().default("Input SGST"),
  TALLY_IGST_LEDGER: z.string().default("Input IGST"),
  TALLY_CESS_LEDGER: z.string().default("Input Cess"),
  TALLY_TDS_LEDGER: z.string().default("TDS Payable"),
  TALLY_TCS_LEDGER: z.string().default("TCS Receivable"),
  DEFAULT_APPROVER: z.string().default("system"),
  INVITE_EMAIL_PROVIDER: z.enum(["smtp", "sendgrid"]).default("smtp"),
  INVITE_SMTP_HOST: z.string().default("mailhog"),
  INVITE_SMTP_PORT: z.coerce.number().default(1125),
  INVITE_SMTP_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  INVITE_SMTP_USERNAME: z.string().default(""),
  INVITE_SMTP_PASSWORD: z.string().default(""),
  INVITE_SENDGRID_API_KEY: z.string().default(""),
  INVITE_SENDGRID_ENDPOINT: z.string().default("https://api.sendgrid.com/v3/mail/send"),
  INVITE_SENDGRID_TIMEOUT_MS: z.coerce.number().default(15000),
  INVITE_FROM: z.string().default("no-reply@invoice.local"),
  INVITE_BASE_URL: z.string().default("http://localhost:5177"),
  MAILBOX_ALERT_SMTP_HOST: z.string().default(""),
  MAILBOX_ALERT_SMTP_PORT: z.coerce.number().default(587),
  MAILBOX_ALERT_SMTP_SECURE: z
    .string()
    .default("false")
    .transform((value) => value === "true"),
  MAILBOX_ALERT_SMTP_USERNAME: z.string().default(""),
  MAILBOX_ALERT_SMTP_PASSWORD: z.string().default(""),
  MAILBOX_ALERT_FROM: z.string().default(""),
  MAILBOX_ALERT_TO: z.string().default(""),

  ANUMATI_ENTITY_ID: z.string().default(""),
  ANUMATI_API_KEY: z.string().default(""),
  ANUMATI_JWS_PRIVATE_KEY: z.string().default(""),
  ANUMATI_AES_KEY: z.string().default(""),
  ANUMATI_AA_BASE_URL: z.string().default(""),
  ANUMATI_WEBVIEW_URL: z.string().default(""),
  ANUMATI_CALLBACK_BASE_URL: z.string().default("")
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
  values.OCR_PROVIDER_BASE_URL ?? (localMlEnv ? "http://localhost:8200/v1" : "")
);
const resolvedSlmBaseUrl = normalizeUrl(
  values.FIELD_VERIFIER_BASE_URL ?? (localMlEnv ? "http://localhost:8300/v1" : "")
);

if (!localMlEnv && values.OCR_PROVIDER !== "llamaparse") {
  if (resolvedOcrBaseUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.error("Invalid env vars: OCR_PROVIDER_BASE_URL is required when ENV is 'stg' or 'prod'.");
    process.exit(1);
  }

  if (values.FIELD_VERIFIER_PROVIDER === "http" && resolvedSlmBaseUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.error("Invalid env vars: FIELD_VERIFIER_BASE_URL is required when ENV is 'stg' or 'prod'.");
    process.exit(1);
  }
}

if (values.OIDC_AUTH_URL.length === 0 || values.OIDC_TOKEN_URL.length === 0 || values.OIDC_VALIDATE_URL.length === 0 || values.OIDC_USERINFO_URL.length === 0) {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid env vars: OIDC_AUTH_URL, OIDC_TOKEN_URL, OIDC_VALIDATE_URL, and OIDC_USERINFO_URL must be configured."
  );
  process.exit(1);
}

if ((values.ENV === "stg" || values.ENV === "prod") && values.GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET === "local-dev-gmail-oauth-encryption-secret") {
  // eslint-disable-next-line no-console
  console.error(
    "Invalid env vars: set GMAIL_OAUTH_TOKEN_ENCRYPTION_SECRET for stg/prod. Do not use the default development secret."
  );
  process.exit(1);
}

if ((values.ENV === "stg" || values.ENV === "prod") && values.APP_SESSION_SIGNING_SECRET === "local-dev-session-signing-secret-change-me") {
  // eslint-disable-next-line no-console
  console.error("Invalid env vars: set APP_SESSION_SIGNING_SECRET for stg/prod.");
  process.exit(1);
}

if ((values.ENV === "stg" || values.ENV === "prod") && values.REFRESH_TOKEN_ENCRYPTION_SECRET === "local-dev-refresh-token-secret-32-chars") {
  // eslint-disable-next-line no-console
  console.error("Invalid env vars: set REFRESH_TOKEN_ENCRYPTION_SECRET for stg/prod.");
  process.exit(1);
}

if ((values.ENV === "stg" || values.ENV === "prod") && values.OIDC_CLIENT_SECRET === "billforge-local-secret") {
  // eslint-disable-next-line no-console
  console.error("Invalid env vars: set OIDC_CLIENT_SECRET for stg/prod. Do not use the default development secret.");
  process.exit(1);
}

if (values.OCR_PROVIDER === "llamaparse" && !values.LLAMA_CLOUD_API_KEY?.trim()) {
  // eslint-disable-next-line no-console
  console.error("Invalid env vars: LLAMA_CLOUD_API_KEY is required when OCR_PROVIDER=llamaparse.");
  process.exit(1);
}

const apiBaseUrl = normalizeUrl(values.API_BASE_URL);

export const env = {
  ...values,
  API_BASE_URL: apiBaseUrl,
  OCR_PROVIDER_BASE_URL: resolvedOcrBaseUrl,
  FIELD_VERIFIER_BASE_URL: resolvedSlmBaseUrl,
  isLocalMlEnv: localMlEnv,
  keycloakInternalBaseUrl: normalizeUrl(values.KEYCLOAK_INTERNAL_BASE_URL),
  keycloakRealm: values.KEYCLOAK_REALM,
  platformAdminEmails: values.PLATFORM_ADMIN_EMAILS.split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  ingestionSources: values.INGESTION_SOURCES.split(",")
    .map((source) => source.trim())
    .filter(Boolean)
};

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path.startsWith("/") ? path : "/" + path}`;
}
