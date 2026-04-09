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

let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];
let proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function flushRefreshQueue(token: string) {
  for (const resolve of refreshQueue) resolve(token);
  refreshQueue = [];
}

function drainRefreshQueue() {
  for (const resolve of refreshQueue) resolve("");
  refreshQueue = [];
}

function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as unknown;
    if (typeof payload !== "object" || payload === null) return null;
    const exp = (payload as Record<string, unknown>).exp;
    return typeof exp === "number" ? exp : null;
  } catch {
    return null;
  }
}

export function scheduleProactiveRefresh(token: string) {
  if (proactiveRefreshTimer !== null) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
  if (!token) return;
  const exp = decodeJwtExp(token);
  if (exp === null) return;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const msUntilRefresh = (exp - nowSeconds - 60) * 1000;
  if (msUntilRefresh <= 0) return;
  proactiveRefreshTimer = setTimeout(() => {
    proactiveRefreshTimer = null;
    const currentToken = getStoredSessionToken();
    if (!currentToken) return;
    void import("./auth").then(({ refreshSessionToken }) =>
      refreshSessionToken(currentToken)
        .then((newToken) => {
          setStoredSessionToken(newToken);
          apiClient.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
          scheduleProactiveRefresh(newToken);
        })
        .catch(() => {
          clearStoredSessionToken();
          window.location.href = "/";
        })
    );
  }, msUntilRefresh);
}

export function cancelProactiveRefresh() {
  if (proactiveRefreshTimer !== null) {
    clearTimeout(proactiveRefreshTimer);
    proactiveRefreshTimer = null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
    const requestUrl = axios.isAxiosError(error) ? (error.config?.url ?? "") : "";
    const isRefreshEndpoint = /\/auth\/refresh(?:\?|$)/.test(requestUrl);
    const isLoginEndpoint = /\/auth\/token(?:\?|$)/.test(requestUrl);

    if (status === 401 && !isRefreshEndpoint && !isLoginEndpoint) {
      const currentToken = getStoredSessionToken();
      if (!currentToken) {
        return Promise.reject(normalizeApiError(error));
      }

      if (isRefreshing) {
        return new Promise<string>((resolve) => {
          refreshQueue.push(resolve);
        }).then((newToken) => {
          if (!newToken) return Promise.reject(normalizeApiError(error));
          const retryConfig = { ...error.config };
          retryConfig.headers = { ...(retryConfig.headers ?? {}) };
          retryConfig.headers["Authorization"] = `Bearer ${newToken}`;
          return axios(retryConfig);
        });
      }

      isRefreshing = true;

      return import("./auth")
        .then(({ refreshSessionToken }) => refreshSessionToken(currentToken))
        .then((newToken) => {
          setStoredSessionToken(newToken);
          apiClient.defaults.headers.common["Authorization"] = `Bearer ${newToken}`;
          scheduleProactiveRefresh(newToken);
          flushRefreshQueue(newToken);
          const retryConfig = { ...error.config };
          retryConfig.headers = { ...(retryConfig.headers ?? {}) };
          retryConfig.headers["Authorization"] = `Bearer ${newToken}`;
          return axios(retryConfig);
        })
        .catch((refreshError) => {
          drainRefreshQueue();
          clearStoredSessionToken();
          cancelProactiveRefresh();
          window.location.href = "/";
          return Promise.reject(normalizeApiError(refreshError));
        })
        .finally(() => {
          isRefreshing = false;
        });
    }

    return Promise.reject(normalizeApiError(error));
  }
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
