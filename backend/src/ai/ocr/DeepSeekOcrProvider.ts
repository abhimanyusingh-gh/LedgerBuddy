import axios from "axios";
import type { OcrExtractionOptions, OcrProvider, OcrResult } from "@/core/interfaces/OcrProvider.js";
import { getCorrelationId, logger } from "@/utils/logger.js";
import {
  DEFAULT_PROMPT,
  buildOcrRequestError,
  buildOcrTranscriptionPrompt,
  estimateTextTokenCount,
  hasTokenUsage,
  normalizeMaxTokens,
  normalizeOcrDocumentResponse,
  normalizePrompt,
  normalizeConfidenceValue,
  readMaxTokensFromEnv,
  readTimeoutMsFromEnv
} from "@/ai/ocr/OcrProviderSupport.js";

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/x-png",
  "application/pdf"
]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"]);

interface OcrHttpClient {
  post(
    url: string,
    body: unknown,
    config: { headers: Record<string, string>; timeout: number }
  ): Promise<{ data: unknown }>;
}

interface OcrProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  prompt?: string;
  maxTokens?: number;
  // Maintained for backward compatibility; prompt output is now always transcription-only.
  enforceKeyValuePairs?: boolean;
  httpClient?: OcrHttpClient;
}

export class DeepSeekOcrProvider implements OcrProvider {
  readonly name = "deepseek";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly prompt: string;
  private readonly maxTokens: number;
  private readonly httpClient: OcrHttpClient;

  constructor(options?: OcrProviderOptions) {
    this.apiKey = options?.apiKey ?? process.env.OCR_PROVIDER_API_KEY ?? "";
    this.model = options?.model ?? process.env.OCR_MODEL ?? "mlx-community/DeepSeek-OCR-4bit";
    this.timeoutMs = options?.timeoutMs ?? readTimeoutMsFromEnv();
    this.prompt = normalizePrompt(options?.prompt ?? process.env.DEEPSEEK_OCR_PROMPT ?? DEFAULT_PROMPT);
    this.maxTokens = normalizeMaxTokens(options?.maxTokens ?? readMaxTokensFromEnv());
    const baseUrl = options?.baseUrl ?? process.env.OCR_PROVIDER_BASE_URL ?? "http://localhost:8200/v1";
    this.httpClient = options?.httpClient ?? axios.create({ baseURL: baseUrl });
  }

  async extractText(buffer: Buffer, mimeType: string, options?: OcrExtractionOptions): Promise<OcrResult> {
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      return {
        text: "",
        confidence: 0,
        provider: this.name
      };
    }

    const correlationId = getCorrelationId();
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey.trim().length > 0) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    if (correlationId) {
      headers["x-correlation-id"] = correlationId;
    }

    const requestBody = {
      model: this.model,
      document: `data:${mimeType};base64,${buffer.toString("base64")}`,
      includeLayout: true,
      prompt: buildOcrTranscriptionPrompt(this.prompt, options?.languageHint),
      maxTokens: this.maxTokens
    };

    const startedAt = Date.now();
    logger.info("ocr.request.start", {
      provider: this.name,
      mimeType,
      model: this.model,
      payloadBytes: buffer.length,
      languageHint: options?.languageHint
    });

    try {
      const response = await postWithRetry(this.httpClient, "/ocr/document", requestBody, headers, this.timeoutMs);
      const payload = normalizeOcrDocumentResponse(response.data);
      logger.info("ocr.request.end", {
        provider: this.name,
        mimeType,
        latencyMs: Date.now() - startedAt,
        blockCount: payload.blocks?.length ?? 0,
        ocrPromptTokens: payload.usage?.promptTokens,
        ocrCompletionTokens: payload.usage?.completionTokens,
        ocrTotalTokens: payload.usage?.totalTokens,
        ocrTokenUsageReturned: hasTokenUsage(payload.usage),
        ocrOutputTokensApprox: estimateTextTokenCount(payload.rawText)
      });

      return {
        text: payload.rawText,
        confidence: normalizeConfidenceValue(payload.confidence),
        provider: this.name,
        blocks: payload.blocks,
        pageImages: payload.pageImages,
        tokenUsage: payload.usage
      };
    } catch (error) {
      logger.error("ocr.request.failed", {
        provider: this.name,
        mimeType,
        latencyMs: Date.now() - startedAt,
        error: buildOcrRequestError(this.name, error)
      });
      throw new Error(buildOcrRequestError(this.name, error));
    }
  }
}

async function postWithRetry(
  httpClient: OcrHttpClient,
  endpoint: string,
  body: unknown,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<{ data: unknown }> {
  let attempt = 0;
  while (true) {
    attempt += 1;
    try {
      return await httpClient.post(endpoint, body, { headers, timeout: timeoutMs });
    } catch (error) {
      if (attempt >= 3 || !isRetryableRequestError(error)) {
        throw error;
      }
      await sleepBeforeRetry(attempt);
    }
  }
}

function isRetryableRequestError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  if (typeof status === "number" && status >= 500) {
    return true;
  }

  return typeof error.code === "string" && RETRYABLE_NETWORK_ERROR_CODES.has(error.code);
}

async function sleepBeforeRetry(attempt: number): Promise<void> {
  if (process.env.NODE_ENV === "test") {
    return;
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
}
