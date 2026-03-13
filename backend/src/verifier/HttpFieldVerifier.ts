import axios, { type AxiosInstance } from "axios";
import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "../core/interfaces/FieldVerifier.js";
import type { ParsedInvoiceData } from "../types/invoice.js";
import { getCorrelationId, logger } from "../utils/logger.js";

interface HttpFieldVerifierOptions {
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  httpClient?: AxiosInstance;
}

interface VerifyInvoiceResponse {
  parsed?: unknown;
  issues?: unknown;
  changedFields?: unknown;
  reasonCodes?: unknown;
  invoiceType?: unknown;
  usage?: unknown;
  tokenUsage?: unknown;
  promptTokens?: unknown;
  completionTokens?: unknown;
  totalTokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
}

interface VerifierTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export class HttpFieldVerifier implements FieldVerifier {
  readonly name = "http";
  private readonly timeoutMs: number;
  private readonly apiKey: string;
  private readonly httpClient: AxiosInstance;

  constructor(private readonly options: HttpFieldVerifierOptions) {
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey?.trim() ?? "";
    this.httpClient = options.httpClient ?? axios.create({ baseURL: options.baseUrl });
  }

  async verify(input: FieldVerifierInput): Promise<FieldVerifierResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const correlationId = getCorrelationId();
    if (correlationId) {
      headers["x-correlation-id"] = correlationId;
    }

    const startedAt = Date.now();
    try {
      const response = await this.httpClient.post<VerifyInvoiceResponse>(
        "/verify/invoice",
        {
          parsed: input.parsed,
          ocrText: input.ocrText,
          ocrBlocks: input.ocrBlocks,
          mode: input.mode,
          hints: input.hints
        },
        {
          timeout: this.timeoutMs,
          headers
        }
      );
      const usage =
        normalizeTokenUsage(response.data?.usage) ??
        normalizeTokenUsage(response.data?.tokenUsage) ??
        normalizeTokenUsage({
          promptTokens: response.data?.promptTokens ?? response.data?.prompt_tokens,
          completionTokens: response.data?.completionTokens ?? response.data?.completion_tokens,
          totalTokens: response.data?.totalTokens ?? response.data?.total_tokens
        });
      const invoiceType = typeof response.data?.invoiceType === "string" ? response.data.invoiceType.trim() : undefined;
      logger.info("verifier.http.request.end", {
        latencyMs: Date.now() - startedAt,
        llmPromptTokens: usage?.promptTokens,
        llmCompletionTokens: usage?.completionTokens,
        llmTotalTokens: usage?.totalTokens,
        llmTokenUsageReturned: hasTokenUsage(usage),
        llmInputTokensApprox: estimateTextTokenCount(input.ocrText),
        llmOutputTokensApprox: estimateTextTokenCount(JSON.stringify(response.data?.parsed ?? {})),
        llmAssist: input.hints.llmAssist ?? false,
        pageImageCount: input.hints.pageImages?.length ?? 0,
        priorCorrectionCount: input.hints.priorCorrections?.length ?? 0,
        invoiceType
      });

      return {
        parsed: normalizeParsed(response.data?.parsed) ?? input.parsed,
        issues: normalizeStringList(response.data?.issues),
        changedFields: normalizeStringList(response.data?.changedFields),
        reasonCodes: normalizeReasonCodes(response.data?.reasonCodes),
        invoiceType,
        tokenUsage: usage
      };
    } catch (error) {
      logger.warn("verifier.http.failed", {
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        parsed: input.parsed,
        issues: ["Field verifier request failed; continuing with deterministic extraction."],
        changedFields: [],
        reasonCodes: {}
      };
    }
  }
}

function normalizeParsed(value: unknown): ParsedInvoiceData | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = value as Record<string, unknown>;
  const parsed: ParsedInvoiceData = {};
  if (typeof source.invoiceNumber === "string" && source.invoiceNumber.trim()) {
    parsed.invoiceNumber = source.invoiceNumber.trim();
  }
  if (typeof source.vendorName === "string" && source.vendorName.trim()) {
    parsed.vendorName = source.vendorName.trim();
  }
  if (typeof source.invoiceDate === "string" && source.invoiceDate.trim()) {
    parsed.invoiceDate = source.invoiceDate.trim();
  }
  if (typeof source.dueDate === "string" && source.dueDate.trim()) {
    parsed.dueDate = source.dueDate.trim();
  }
  if (typeof source.currency === "string" && source.currency.trim()) {
    parsed.currency = source.currency.trim().toUpperCase();
  }
  if (Number.isInteger(source.totalAmountMinor)) {
    parsed.totalAmountMinor = Number(source.totalAmountMinor);
  }
  if (Array.isArray(source.notes)) {
    const notes = source.notes.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    if (notes.length > 0) {
      parsed.notes = notes;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function normalizeReasonCodes(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.trim().length > 0) {
      output[key] = entry.trim();
    }
  }
  return output;
}

function normalizeTokenUsage(value: unknown): VerifierTokenUsage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const usage: VerifierTokenUsage = {};
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

function hasTokenUsage(usage: VerifierTokenUsage | undefined): boolean {
  if (!usage) {
    return false;
  }
  return usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined;
}

function estimateTextTokenCount(text: string): number {
  const normalized = text.trim();
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\s+/).filter((entry) => entry.length > 0).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
