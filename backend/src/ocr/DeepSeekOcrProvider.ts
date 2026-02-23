import axios from "axios";
import type { OcrBlock, OcrProvider, OcrResult } from "../core/interfaces/OcrProvider.js";
import { getCorrelationId, logger } from "../utils/logger.js";

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/png",
  "image/x-png",
  "application/pdf"
]);
const RETRYABLE_NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"]);
const DEFAULT_PROMPT = "<image>\n<|grounding|>Convert page to markdown.";
const DEFAULT_MAX_TOKENS = 512;
const DEFAULT_TIMEOUT_MS = 3_600_000;

interface OcrDocumentApiResponse {
  rawText?: unknown;
  raw_text?: unknown;
  confidence?: unknown;
  blocks?: unknown;
}

interface DeepSeekHttpClient {
  post(
    url: string,
    body: unknown,
    config: { headers: Record<string, string>; timeout: number }
  ): Promise<{ data: unknown }>;
}

interface DeepSeekOcrProviderOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
  prompt?: string;
  maxTokens?: number;
  httpClient?: DeepSeekHttpClient;
}

export class DeepSeekOcrProvider implements OcrProvider {
  readonly name = "deepseek";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly prompt: string;
  private readonly maxTokens: number;
  private readonly httpClient: DeepSeekHttpClient;

  constructor(options?: DeepSeekOcrProviderOptions) {
    this.apiKey = options?.apiKey ?? process.env.DEEPSEEK_API_KEY ?? "";
    this.model = options?.model ?? process.env.DEEPSEEK_OCR_MODEL ?? "deepseek-ai/DeepSeek-OCR";
    this.timeoutMs = options?.timeoutMs ?? readTimeoutMsFromEnv();
    this.prompt = normalizePrompt(options?.prompt ?? process.env.DEEPSEEK_OCR_PROMPT ?? DEFAULT_PROMPT);
    this.maxTokens = normalizeMaxTokens(options?.maxTokens ?? readMaxTokensFromEnv());
    const baseUrl = options?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "http://localhost:8000/v1";
    this.httpClient = options?.httpClient ?? axios.create({ baseURL: baseUrl });
  }

  async extractText(buffer: Buffer, mimeType: string): Promise<OcrResult> {
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
      prompt: this.prompt,
      maxTokens: this.maxTokens
    };

    const startedAt = Date.now();
    logger.info("ocr.request.start", {
      provider: this.name,
      mimeType,
      model: this.model,
      payloadBytes: buffer.length
    });

    try {
      const response = await postWithRetry(this.httpClient, "/ocr/document", requestBody, headers, this.timeoutMs);
      const payload = parseOcrDocumentResponse(response.data);
      logger.info("ocr.request.end", {
        provider: this.name,
        mimeType,
        latencyMs: Date.now() - startedAt,
        blockCount: payload.blocks?.length ?? 0
      });

      return {
        text: payload.rawText,
        confidence: normalizeConfidence(payload.confidence),
        provider: this.name,
        blocks: payload.blocks
      };
    } catch (error) {
      logger.error("ocr.request.failed", {
        provider: this.name,
        mimeType,
        latencyMs: Date.now() - startedAt,
        error: buildDeepSeekRequestError(error)
      });
      throw new Error(buildDeepSeekRequestError(error));
    }
  }
}

async function postWithRetry(
  httpClient: DeepSeekHttpClient,
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

function parseOcrDocumentResponse(data: unknown): { rawText: string; confidence?: number; blocks?: OcrBlock[] } {
  if (!isRecord(data)) {
    return { rawText: "" };
  }

  const payload = data as OcrDocumentApiResponse;
  return {
    rawText: normalizeText(payload.rawText) ?? normalizeText(payload.raw_text) ?? "",
    confidence: normalizeNumber(payload.confidence),
    blocks: normalizeBlocks(payload.blocks)
  };
}

function normalizeConfidence(value?: number): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  if (value > 1) {
    return Math.max(0, Math.min(1, Number((value / 100).toFixed(4))));
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function buildDeepSeekRequestError(error: unknown): string {
  if (!axios.isAxiosError(error)) {
    return `DeepSeek OCR request failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  const status = error.response?.status;
  const responseData = error.response?.data;
  let message = error.message;

  if (isRecord(responseData)) {
    const nestedError = responseData.error;
    const nestedErrorMessage =
      isRecord(nestedError) && typeof nestedError.message === "string" ? nestedError.message : undefined;
    const topLevelMessage = typeof responseData.message === "string" ? responseData.message : undefined;
    const detailMessage = typeof responseData.detail === "string" ? responseData.detail : undefined;
    message = nestedErrorMessage ?? topLevelMessage ?? detailMessage ?? message;
  }

  return `DeepSeek OCR request failed${status ? ` (${status})` : ""}: ${message}`;
}

function readTimeoutMsFromEnv(): number {
  const rawValue = process.env.DEEPSEEK_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

function readMaxTokensFromEnv(): number {
  const rawValue = process.env.DEEPSEEK_OCR_MAX_TOKENS;
  if (!rawValue) {
    return DEFAULT_MAX_TOKENS;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MAX_TOKENS;
}

function normalizePrompt(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PROMPT;
}

function normalizeMaxTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.max(64, Math.min(4096, Math.round(value)));
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeBlocks(value: unknown): OcrBlock[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const blocks: OcrBlock[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const text = normalizeText(entry.text) ?? normalizeText(entry.label);
    const bbox = normalizeBox(entry.bbox) ?? normalizeBox([entry.x1, entry.y1, entry.x2, entry.y2]);
    if (!text || !bbox) {
      continue;
    }

    const bboxNormalized =
      normalizeBox(entry.bboxNormalized) ?? normalizeBox(entry.bbox_normalized) ?? normalizeBox(entry.bboxNorm);
    const bboxModel = normalizeBox(entry.bboxModel) ?? normalizeBox(entry.bbox_model);
    const blockType = normalizeText(entry.blockType) ?? normalizeText(entry.type);
    const page = normalizePageNumber(entry.page);

    blocks.push({
      text,
      page,
      bbox,
      ...(bboxNormalized ? { bboxNormalized } : {}),
      ...(bboxModel ? { bboxModel } : {}),
      ...(blockType ? { blockType } : {})
    });
  }

  return blocks.length > 0 ? blocks : undefined;
}

function normalizeBox(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }
  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

function normalizePageNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
