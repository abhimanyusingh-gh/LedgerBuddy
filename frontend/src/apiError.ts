import axios from "axios";

interface ApiErrorPayload {
  message?: unknown;
  error?: unknown;
  reason?: unknown;
  code?: unknown;
}

export class ApiClientError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly rawMessage?: string;

  constructor(message: string, options?: { status?: number; code?: string; rawMessage?: string }) {
    super(message);
    this.name = "ApiClientError";
    this.status = options?.status;
    this.code = options?.code;
    this.rawMessage = options?.rawMessage;
  }
}

export function normalizeApiError(error: unknown): ApiClientError {
  if (error instanceof ApiClientError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    const status = typeof error.response?.status === "number" ? error.response.status : undefined;
    const payload = isApiErrorPayload(error.response?.data) ? error.response?.data : {};
    const code = readPayloadString(payload.code);
    const rawMessage = pickRawMessage(payload);
    const requestUrl = typeof error.config?.url === "string" ? error.config.url : "";
    const isLoginRequest = /\/auth\/token(?:\?|$)/.test(requestUrl);
    const message = mapUserMessage({
      status,
      code,
      rawMessage,
      isLoginRequest,
      hasResponse: Boolean(error.response)
    });
    return new ApiClientError(message, {
      status,
      code,
      rawMessage
    });
  }

  if (error instanceof Error) {
    const fallback = sanitizeRawMessage(error.message);
    return new ApiClientError(fallback || "We could not complete your request. Please try again.");
  }

  return new ApiClientError("We could not complete your request. Please try again.");
}

export function isAuthenticationError(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401;
}

export function getUserFacingErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }

  if (error instanceof Error) {
    const sanitized = sanitizeRawMessage(error.message);
    return sanitized || fallback;
  }

  return fallback;
}

function mapUserMessage(input: {
  status?: number;
  code?: string;
  rawMessage?: string;
  isLoginRequest: boolean;
  hasResponse: boolean;
}): string {
  const raw = sanitizeRawMessage(input.rawMessage);
  if (!input.hasResponse) {
    return "Unable to reach the server. Check your connection and try again.";
  }

  if (input.code === "tenant_disabled") {
    return "This account has been disabled. Contact your administrator.";
  }

  if (input.code === "user_disabled") {
    return "Your account has been disabled. Contact your tenant administrator.";
  }

  if (input.code === "auth_user_not_provisioned") {
    return "Your account has not been set up yet. Contact your administrator.";
  }

  if (input.status === 401) {
    if (input.isLoginRequest) {
      return raw || "Invalid email or password.";
    }
    return "Your session has expired. Please sign in again.";
  }

  if (input.status === 403) {
    return raw || "You do not have permission to perform this action.";
  }

  if (input.status === 404) {
    return raw || "The requested resource was not found.";
  }

  if (input.status === 408 || input.status === 504) {
    return "The request timed out. Please try again.";
  }

  if (input.status === 429) {
    return "Too many requests. Please wait a moment and try again.";
  }

  if (typeof input.status === "number" && input.status >= 500) {
    return "Something went wrong on the server. Please try again.";
  }

  if (raw) {
    return raw;
  }

  return "We could not complete your request. Please try again.";
}

function pickRawMessage(payload: ApiErrorPayload): string | undefined {
  return readPayloadString(payload.message) ?? readPayloadString(payload.error) ?? readPayloadString(payload.reason);
}

function readPayloadString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeRawMessage(message: string | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  const trimmed = message.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^request failed with status code \d+$/i.test(trimmed)) {
    return undefined;
  }

  if (/^network error$/i.test(trimmed)) {
    return undefined;
  }

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(trimmed)) {
    return undefined;
  }

  if (/^Error:|^TypeError:|^RangeError:|^SyntaxError:/i.test(trimmed)) {
    return undefined;
  }

  return trimmed;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
