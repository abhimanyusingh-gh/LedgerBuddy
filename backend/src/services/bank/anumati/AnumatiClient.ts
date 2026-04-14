import { jwsSign } from "./AnumatiCrypto.js";

interface AnumatiClientConfig {
  entityId: string;
  apiKey: string;
  privateKeyPem: string;
  baseUrl: string;
  timeoutMs?: number;
}

function assertValidResponseBody(data: unknown): asserts data is Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Anumati API returned invalid response body: expected object, got ${Array.isArray(data) ? "array" : typeof data}`);
  }
}

export class AnumatiClient {
  private readonly config: Required<AnumatiClientConfig>;

  constructor(config: AnumatiClientConfig) {
    this.config = { timeoutMs: 15000, ...config };
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const timestamp = new Date().toISOString();
    const payload = JSON.stringify({ ...((body as object) ?? {}), entityId: this.config.entityId, timestamp });
    const jws = jwsSign(payload, this.config.privateKeyPem);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "x-jws-signature": jws
        },
        body: payload,
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Anumati API error ${response.status}: ${text}`);
      }

      const data: unknown = await response.json();
      assertValidResponseBody(data);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`
        },
        signal: controller.signal
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Anumati API error ${response.status}: ${text}`);
      }

      const data: unknown = await response.json();
      assertValidResponseBody(data);
      return data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
