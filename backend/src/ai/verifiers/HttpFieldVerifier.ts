import axios, { type AxiosInstance } from "axios";
import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.js";
import {
  normalizeClassification,
  normalizeFieldConfidence,
  normalizeFieldProvenance,
  normalizeLineItemProvenance
} from "../extractors/invoice/stages/provenance.js";
import {
  fieldProvenanceFromVerifierContract,
  lineItemProvenanceFromVerifierContract,
  parseVerifierParsedResponse,
  normalizeReasonCodes,
  normalizeVerifierContract,
  parsedFromVerifierContract
} from "./httpFieldVerifierNormalizer.js";
import { getCorrelationId, logger } from "@/utils/logger.js";

interface HttpFieldVerifierOptions {
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  httpClient?: AxiosInstance;
}

interface VerifyInvoiceResponse {
  result?: unknown;
  parsed?: unknown;
  issues?: unknown;
  changedFields?: unknown;
  reasonCodes?: unknown;
  invoiceType?: unknown;
  fieldConfidence?: unknown;
  fieldProvenance?: unknown;
  lineItemProvenance?: unknown;
  classification?: unknown;
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
  private queueTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: HttpFieldVerifierOptions) {
    this.timeoutMs = options.timeoutMs;
    this.apiKey = options.apiKey?.trim() ?? "";
    this.httpClient = options.httpClient ?? axios.create({ baseURL: options.baseUrl });
  }

  async verify(input: FieldVerifierInput): Promise<FieldVerifierResult> {
    return new Promise<FieldVerifierResult>((resolve, reject) => {
      this.queueTail = this.queueTail
        .then(() => this.verifySerial(input))
        .then(resolve, reject);
    });
  }

  private async verifySerial(input: FieldVerifierInput): Promise<FieldVerifierResult> {
    const maxRetries = 3;
    const retryDelayMs = 15_000;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) {
        logger.warn("verifier.http.retry", { attempt, waitMs: retryDelayMs });
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        try {
          await this.httpClient.get("/../health", { timeout: 5_000 });
        } catch {
          logger.warn("verifier.http.health.failed", { attempt });
          continue;
        }
      }

      const result = await this.tryVerify(input);
      if (result.success) {
        return result.value!;
      }
      lastError = result.error;

      const isConnectionError =
        lastError?.message?.includes("ECONNREFUSED") ||
        lastError?.message?.includes("ECONNRESET") ||
        lastError?.message?.includes("socket hang up") ||
        lastError?.message?.includes("Network is unreachable") ||
        lastError?.message?.includes("timeout");
      if (!isConnectionError) {
        break;
      }
    }

    throw new Error(`SLM verification failed after ${maxRetries} attempts: ${lastError?.message ?? "unknown"}`);
  }

  private async tryVerify(
    input: FieldVerifierInput
  ): Promise<{ success: boolean; value?: FieldVerifierResult; error?: Error }> {
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
      const contract = normalizeVerifierContract(response.data?.result);
      const parsedPayload = isRecord(response.data?.parsed) ? (response.data?.parsed as Record<string, unknown>) : undefined;
      const contractParsed = contract ? parsedFromVerifierContract(contract) : undefined;
      const contractFieldProvenance = contract ? fieldProvenanceFromVerifierContract(contract) : undefined;
      const contractLineItemProvenance = contract ? lineItemProvenanceFromVerifierContract(contract) : undefined;
      const fieldConfidence = normalizeFieldConfidence(response.data?.fieldConfidence ?? parsedPayload?._fieldConfidence);
      const fieldProvenance = normalizeFieldProvenance(
        response.data?.fieldProvenance ?? parsedPayload?._fieldProvenance ?? contractFieldProvenance
      );
      const lineItemProvenance = normalizeLineItemProvenance(
        response.data?.lineItemProvenance ?? parsedPayload?._lineItemProvenance ?? contractLineItemProvenance
      );
      const classification = normalizeClassification(
        response.data?.classification ?? parsedPayload?._classification ?? (invoiceType ? { invoiceType } : undefined)
      );

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
        success: true,
        value: {
          parsed: contractParsed ?? parseVerifierParsedResponse(response.data?.parsed) ?? input.parsed,
          issues: normalizeStringList(response.data?.issues),
          changedFields: normalizeStringList(response.data?.changedFields),
          reasonCodes: normalizeReasonCodes(response.data?.reasonCodes),
          invoiceType,
          tokenUsage: usage,
          ...(contract ? { contract } : {}),
          ...(fieldConfidence ? { fieldConfidence } : {}),
          ...(fieldProvenance ? { fieldProvenance } : {}),
          ...(lineItemProvenance && lineItemProvenance.length > 0 ? { lineItemProvenance } : {}),
          ...(classification ? { classification } : {})
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("verifier.http.failed", {
        latencyMs: Date.now() - startedAt,
        error: errorMessage
      });
      return { success: false, error: error instanceof Error ? error : new Error(errorMessage) };
    }
  }
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
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
