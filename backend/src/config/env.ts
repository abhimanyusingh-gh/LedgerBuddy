import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
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
  DEEPSEEK_BASE_URL: z.string().default("http://localhost:8000/v1"),
  DEEPSEEK_OCR_MODEL: z.string().default("deepseek-ai/DeepSeek-OCR"),
  DEEPSEEK_TIMEOUT_MS: z.coerce.number().default(3600000),
  MOCK_OCR_TEXT: z.string().optional(),
  MOCK_OCR_CONFIDENCE: z.coerce.number().optional(),
  OCR_HIGH_CONFIDENCE_THRESHOLD: z.coerce.number().default(0.88),

  FIELD_VERIFIER_PROVIDER: z.enum(["none", "http"]).default("http"),
  FIELD_VERIFIER_BASE_URL: z.string().default("http://localhost:8100/v1"),
  FIELD_VERIFIER_TIMEOUT_MS: z.coerce.number().default(20000),
  FIELD_VERIFIER_API_KEY: z.string().optional(),

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

export const env = {
  ...values,
  ingestionSources: values.INGESTION_SOURCES.split(",")
    .map((source) => source.trim())
    .filter(Boolean)
};
