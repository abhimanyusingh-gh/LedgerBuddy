import axios from "axios";
import type { OcrBlock, OcrExtractionOptions, OcrPageImage, OcrProvider, OcrResult } from "../core/interfaces/OcrProvider.js";
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
const DEFAULT_PROMPT =
  "Transcribe all visible text exactly as written. Preserve numbers, punctuation, spacing, and line breaks. Do not summarize. Do not format as key-value pairs.";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TIMEOUT_MS = 3_600_000;

interface OcrDocumentApiResponse {
  rawText?: unknown;
  raw_text?: unknown;
  confidence?: unknown;
  blocks?: unknown;
  pageImages?: unknown;
  usage?: unknown;
  tokenUsage?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
}

interface OcrTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
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
  // Maintained for backward compatibility; prompt output is now always transcription-only.
  enforceKeyValuePairs?: boolean;
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
    this.model = options?.model ?? process.env.DEEPSEEK_OCR_MODEL ?? "mlx-community/DeepSeek-OCR-4bit";
    this.timeoutMs = options?.timeoutMs ?? readTimeoutMsFromEnv();
    this.prompt = normalizePrompt(options?.prompt ?? process.env.DEEPSEEK_OCR_PROMPT ?? DEFAULT_PROMPT);
    this.maxTokens = normalizeMaxTokens(options?.maxTokens ?? readMaxTokensFromEnv());
    const baseUrl = options?.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "http://localhost:8200/v1";
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
      prompt: buildPrompt(this.prompt, options?.languageHint),
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
      const payload = parseOcrDocumentResponse(response.data);
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
        confidence: normalizeConfidence(payload.confidence),
        provider: this.name,
        blocks: payload.blocks,
        pageImages: payload.pageImages
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

function parseOcrDocumentResponse(data: unknown): {
  rawText: string;
  confidence?: number;
  blocks?: OcrBlock[];
  pageImages?: OcrPageImage[];
  usage?: OcrTokenUsage;
} {
  if (!isRecord(data)) {
    return { rawText: "" };
  }

  const payload = data as OcrDocumentApiResponse;
  const usage =
    normalizeTokenUsage(payload.usage) ??
    normalizeTokenUsage(payload.tokenUsage) ??
    normalizeTokenUsage({
      promptTokens: payload.promptTokens ?? payload.prompt_tokens,
      completionTokens: payload.completionTokens ?? payload.completion_tokens,
      totalTokens: payload.totalTokens ?? payload.total_tokens
    });
  return {
    rawText: normalizeText(payload.rawText) ?? normalizeText(payload.raw_text) ?? "",
    confidence: normalizeNumber(payload.confidence),
    blocks: normalizeBlocks(payload.blocks),
    pageImages: normalizePageImages(payload.pageImages),
    ...(usage ? { usage } : {})
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
  const trimmed = stripVisionPromptTokens(value);
  return trimmed.length > 0 ? trimmed : DEFAULT_PROMPT;
}

function buildPrompt(prompt: string, languageHint: string | undefined): string {
  const sections: string[] = [prompt];

  const normalizedHint = normalizeLanguageHint(languageHint);
  if (normalizedHint) {
    sections.push(`Document language hint: ${normalizedHint}. Preserve native language.`);
  }

  return sections.join("\n\n").trim();
}

function normalizeLanguageHint(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z]{2,8}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

function stripVisionPromptTokens(value: string): string {
  return value
    .replace(/<\|image_\d+\|>/gi, "")
    .replace(/<image>/gi, "")
    .replace(/[ \t]+\n/g, "")
    .replace(/\n[ \t]+/g, "")
    .replace(/[ \t]{2,}/g, "")
    .replace(/\n{3,}/g, "")
    .trim();
}

function normalizeMaxTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.max(64, Math.min(4096, Math.round(value)));
}

function normalizeTokenUsage(value: unknown): OcrTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: OcrTokenUsage = {};
  const promptTokens = normalizeTokenCount((value.promptTokens ?? value.prompt_tokens) as unknown);
  const completionTokens = normalizeTokenCount((value.completionTokens ?? value.completion_tokens) as unknown);
  const totalTokens = normalizeTokenCount((value.totalTokens ?? value.total_tokens) as unknown);

  if (promptTokens !== undefined) {
    usage.promptTokens = promptTokens;
  }
  if (completionTokens !== undefined) {
    usage.completionTokens = completionTokens;
  }
  if (totalTokens !== undefined) {
    usage.totalTokens = totalTokens;
  }

  return hasTokenUsage(usage) ? usage : undefined;
}

function normalizeTokenCount(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }
  return Math.round(parsed);
}

function hasTokenUsage(usage: OcrTokenUsage | undefined): boolean {
  if (!usage) {
    return false;
  }
  return (
    usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined
  );
}

function estimateTextTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter((entry) => entry.length > 0).length;
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

    const text = mergeBlockText(normalizeText(entry.label), normalizeText(entry.text), normalizeText(entry.type));
    const bbox = normalizeBox(entry.bbox) ?? normalizeBox([entry.x1, entry.y1, entry.x2, entry.y2]);
    if (!text || !bbox) {
      continue;
    }

    const bboxNormalized =
      normalizeBox(entry.bboxNormalized) ?? normalizeBox(entry.bbox_normalized) ?? normalizeBox(entry.bboxNorm);
    const bboxModel = normalizeModelBox(entry.bboxModel) ?? normalizeModelBox(entry.bbox_model);
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

function normalizePageImages(value: unknown): OcrPageImage[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const pageImages: OcrPageImage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }

    const page = normalizePageNumber(entry.page);
    const mimeType = normalizeText(entry.mimeType) ?? "image/png";
    const dataUrl = normalizeText(entry.dataUrl);
    if (!dataUrl || !dataUrl.startsWith("data:")) {
      continue;
    }

    const width = normalizePositiveInteger(entry.width);
    const height = normalizePositiveInteger(entry.height);
    const dpi = normalizePositiveInteger(entry.dpi);

    pageImages.push({
      page,
      mimeType,
      dataUrl,
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
      ...(dpi ? { dpi } : {})
    });
  }

  return pageImages.length > 0 ? pageImages : undefined;
}

function normalizeBox(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) {
    return undefined;
  }
  const numbers = value.map((entry) => Number(entry));
  if (!numbers.every((entry) => Number.isFinite(entry))) {
    return undefined;
  }
  const x1 = Math.min(numbers[0], numbers[2]);
  const y1 = Math.min(numbers[1], numbers[3]);
  const x2 = Math.max(numbers[0], numbers[2]);
  const y2 = Math.max(numbers[1], numbers[3]);
  if (x1 === x2 || y1 === y2) {
    return undefined;
  }
  return [x1, y1, x2, y2];
}

function normalizeModelBox(value: unknown): [number, number, number, number] | undefined {
  const box = normalizeBox(value);
  if (!box) {
    return undefined;
  }
  return [
    Math.max(0, Math.min(999, box[0])),
    Math.max(0, Math.min(999, box[1])),
    Math.max(0, Math.min(999, box[2])),
    Math.max(0, Math.min(999, box[3]))
  ];
}

function normalizePageNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : 1;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : undefined;
}

function mergeBlockText(label: string | undefined, text: string | undefined, type: string | undefined): string | undefined {
  const normalizedText = text?.trim();
  const normalizedLabel = label?.trim();

  if (normalizedText && normalizedLabel) {
    const lowerText = normalizedText.toLowerCase();
    const lowerLabel = normalizedLabel.toLowerCase();
    const shouldJoin =
      !lowerText.includes(lowerLabel) &&
      lowerLabel.length >= 2 &&
      !/^(text|line|table|header|footer|title)$/i.test(normalizedLabel) &&
      !/^(text|line|table|header|footer|title)$/i.test(type ?? "");
    if (shouldJoin) {
      return `${normalizedLabel}: ${normalizedText}`;
    }
    return normalizedText;
  }

  return normalizedText ?? normalizedLabel;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
