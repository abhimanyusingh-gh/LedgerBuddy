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

      return {
        parsed: normalizeParsed(response.data?.parsed) ?? input.parsed,
        issues: normalizeStringList(response.data?.issues),
        changedFields: normalizeStringList(response.data?.changedFields)
      };
    } catch (error) {
      logger.warn("verifier.http.failed", {
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        parsed: input.parsed,
        issues: ["Field verifier request failed; continuing with deterministic extraction."],
        changedFields: []
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
