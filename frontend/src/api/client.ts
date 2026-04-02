import axios from "axios";
import { normalizeApiError } from "../apiError";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4100/api";
const SESSION_TOKEN_KEY = "billforge_session_token";

export const apiClient = axios.create({ baseURL: apiBaseUrl });

apiClient.interceptors.request.use((config) => {
  const token = getStoredSessionToken();
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(normalizeApiError(error))
);

export function getStoredSessionToken(): string {
  return window.localStorage.getItem(SESSION_TOKEN_KEY) ?? "";
}

export function setStoredSessionToken(token: string): void {
  const normalized = token.trim();
  if (normalized.length === 0) {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(SESSION_TOKEN_KEY, normalized);
}

export function clearStoredSessionToken(): void {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

export function safeNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function stripNulls(value: unknown): unknown {
  if (value == null) return undefined;
  if (Array.isArray(value)) return value.map((e) => (e == null ? e : stripNulls(e)));
  if (typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const s = stripNulls(v);
    if (s !== undefined) output[k] = s;
  }
  return output;
}

export function authenticatedUrl(path: string, params?: Record<string, unknown>): string {
  const raw = apiClient.getUri({ url: path, params });
  const resolved = new URL(raw, window.location.origin);
  const token = getStoredSessionToken();
  if (token) resolved.searchParams.set("authToken", token);
  return resolved.toString();
}
