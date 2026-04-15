import axios from "axios";
import type { OcrBlock, OcrPageImage } from "@/core/interfaces/OcrProvider.js";
import { IMAGE_MIME_TYPE, type ImageMimeType } from "@/types/mime.js";

export const DEFAULT_PROMPT =
  "Transcribe all visible text exactly as written. Preserve numbers, punctuation, spacing, and line breaks. Do not summarize. Do not format as key-value pairs. In Indian invoices, /- or /= after a number means 'rupees only' — transcribe as separate characters (e.g., 300/- not 3001).";
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

interface NormalizedOcrDocumentResponse {
  rawText: string;
  confidence?: number;
  blocks?: OcrBlock[];
  pageImages?: OcrPageImage[];
  usage?: OcrTokenUsage;
}

export function readTimeoutMsFromEnv(): number {
  const rawValue = process.env.OCR_TIMEOUT_MS;
  if (!rawValue) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return parsed;
}

export function readMaxTokensFromEnv(): number {
  const rawValue = process.env.OCR_MAX_TOKENS;
  if (!rawValue) {
    return DEFAULT_MAX_TOKENS;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : DEFAULT_MAX_TOKENS;
}

export function normalizePrompt(value: string): string {
  const trimmed = stripVisionPromptTokens(value);
  return trimmed.length > 0 ? trimmed : DEFAULT_PROMPT;
}

export function normalizeMaxTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_MAX_TOKENS;
  }
  return Math.max(64, Math.min(4096, Math.round(value)));
}

export function buildOcrTranscriptionPrompt(prompt: string, languageHint: string | undefined): string {
  const sections: string[] = [prompt];
  const normalizedHint = normalizeLanguageHint(languageHint);
  if (normalizedHint) {
    sections.push(`Document language hint: ${normalizedHint}. Preserve native language.`);
  }
  return sections.join("\n\n").trim();
}

export function normalizeOcrDocumentResponse(data: unknown): NormalizedOcrDocumentResponse {
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
    confidence: normalizeConfidenceValue(payload.confidence),
    blocks: normalizeBlocks(payload.blocks),
    pageImages: normalizePageImages(payload.pageImages),
    ...(usage ? { usage } : {})
  };
}

export function normalizeConfidenceValue(value?: unknown): number | undefined {
  if (typeof value === "number") {
    if (value === value) {
      return Math.max(0, Math.min(1, value > 1 ? Number((value / 100).toFixed(4)) : Number(value.toFixed(4))));
    }
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed > 1 ? Math.max(0, Math.min(1, Number((parsed / 100).toFixed(4)))) : Math.max(0, Math.min(1, Number(parsed.toFixed(4))));
}

export function estimateTextTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter((entry) => entry.length > 0).length;
}

export function hasTokenUsage(usage: OcrTokenUsage | undefined): boolean {
  if (!usage) {
    return false;
  }
  return usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined;
}

export function buildOcrRequestError(providerName: string, error: unknown): string {
  if (!isAxiosLikeError(error)) {
    return `${providerName} OCR request failed: ${error instanceof Error ? error.message : String(error)}`;
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

  return `${providerName} OCR request failed${status ? ` (${status})` : ""}: ${message}`;
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
    const mimeType = (normalizeText(entry.mimeType) ?? IMAGE_MIME_TYPE.PNG) as ImageMimeType;
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

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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

function isAxiosLikeError(error: unknown): error is {
  message: string;
  response?: { status?: number; data?: unknown };
} {
  return axios.isAxiosError(error);
}
