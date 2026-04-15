export const OCR_PROVIDER_NAME = {
  AUTO: "auto",
  DEEPSEEK: "deepseek",
  MOCK: "mock",
  LLAMAPARSE: "llamaparse",
} as const;

export type OcrProviderName = (typeof OCR_PROVIDER_NAME)[keyof typeof OCR_PROVIDER_NAME];

export const MAX_UPLOAD_FILE_COUNT = 50;
export const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const SSE_HEARTBEAT_INTERVAL_MS = 30_000;
export const RERUN_MAX_COUNT = 5;
export const EXPORT_SAVE_CONCURRENCY = 20;
export const OCR_BOOTSTRAP_TIMEOUT_MS = 5_000;
export const VERIFIER_BOOTSTRAP_TIMEOUT_MS = 5_000;
export const ALLOWED_UPLOAD_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
export const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp"
]);
export const PRESIGNED_URL_EXPIRY_SECONDS = 900;
