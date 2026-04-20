import { DeepSeekOcrProvider } from "@/ai/ocr/DeepSeekOcrProvider.ts";
import { runWithLogContext } from "@/utils/logger.ts";
import { logger } from "@/utils/logger.ts";
import type { DocumentMimeType } from "@/types/mime.ts";

describe("DeepSeekOcrProvider", () => {
  const previousEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...previousEnv };
  });

  afterAll(() => {
    process.env = previousEnv;
  });

  it("returns empty OCR output for unsupported mime types", async () => {
    const post = jest.fn();
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await expect(provider.extractText(Buffer.from("x"), "text/plain" as DocumentMimeType)).resolves.toEqual({
      text: "",
      confidence: 0,
      provider: "deepseek"
    });
    expect(post).not.toHaveBeenCalled();
  });

  describe("request shape from config", () => {
    it("adds Authorization header when api key is provided", async () => {
      const post = jest.fn(async (_url: string, _body: unknown, config: { headers: Record<string, string> }) => {
        expect(config.headers.Authorization).toBe("Bearer local-key");
        return { data: { rawText: "ok" } };
      });
      const provider = new DeepSeekOcrProvider({ apiKey: "local-key", httpClient: { post } });
      await provider.extractText(Buffer.from("png"), "image/png");
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("includes includeLayout=true and confidence normalization for PDFs", async () => {
      const post = jest.fn(async (_url: string, body: { includeLayout: boolean }) => {
        expect(body.includeLayout).toBe(true);
        return { data: { raw_text: "pdf text", confidence: 0.92 } };
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");
      expect(result.text).toBe("pdf text");
      expect(result.confidence).toBe(0.92);
    });

    it.each<{ name: string; envVar?: { key: string; value: string }; ctor?: Record<string, unknown>; assertBody: (body: Record<string, unknown>, config: Record<string, unknown>) => void }>([
      {
        name: "uses env timeout when valid",
        envVar: { key: "OCR_TIMEOUT_MS", value: "1234" },
        assertBody: (_body, config) => expect(config["timeout"]).toBe(1234)
      },
      {
        name: "falls back to default timeout when env value is invalid",
        envVar: { key: "OCR_TIMEOUT_MS", value: "oops" },
        assertBody: (_body, config) => expect(config["timeout"]).toBe(3600000)
      },
      {
        name: "uses env max-tokens override when valid",
        envVar: { key: "OCR_MAX_TOKENS", value: "777" },
        assertBody: (body) => expect(body["maxTokens"]).toBe(777)
      }
    ])("config → request shape: $name", async ({ envVar, ctor, assertBody }) => {
      if (envVar) process.env[envVar.key] = envVar.value;
      const post = jest.fn(async (_url: string, body: Record<string, unknown>, config: Record<string, unknown>) => {
        assertBody(body, config);
        return { data: { rawText: "ok" } };
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post }, ...ctor });
      await provider.extractText(Buffer.from("img"), "image/png");
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("uses default max-tokens (2048) when ctor override is invalid", async () => {
      const post = jest.fn(async (_url: string, body: { maxTokens: number }) => {
        expect(body.maxTokens).toBe(2048);
        return { data: { rawText: "ok" } };
      });
      const provider = new DeepSeekOcrProvider({ maxTokens: -1, httpClient: { post } });
      await provider.extractText(Buffer.from("img"), "image/png");
    });
  });

  describe("prompt hygiene", () => {
    it("strips image placeholders from configured OCR prompt", async () => {
      const post = jest.fn(async (_url: string, body: { prompt: string }) => {
        expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
        expect(body.prompt).not.toContain("<image>");
        expect(body.prompt).not.toContain("<|image_1|>");
        return { data: { rawText: "invoice text" } };
      });
      const provider = new DeepSeekOcrProvider({
        prompt: "<image>\nTranscribe all visible text exactly as written. Preserve numbers and layout. <|image_1|>",
        httpClient: { post }
      });
      await provider.extractText(Buffer.from("png"), "image/png");
    });

    it("appends language hint when provided", async () => {
      const post = jest.fn(async (_url: string, body: { prompt: string }) => {
        expect(body.prompt).toContain("Document language hint: fr. Preserve native language.");
        return { data: { rawText: "x" } };
      });
      const provider = new DeepSeekOcrProvider({
        prompt: "Transcribe all visible text exactly as written. Preserve numbers and layout.",
        httpClient: { post }
      });
      await provider.extractText(Buffer.from("png"), "image/png", { languageHint: "fr" });
    });

    it("ignores invalid language-hint values", async () => {
      const post = jest.fn(async (_url: string, body: { prompt: string }) => {
        expect(body.prompt).not.toContain("Document language hint:");
        return { data: { rawText: "x" } };
      });
      const provider = new DeepSeekOcrProvider({
        prompt: "Transcribe all visible text exactly as written. Preserve numbers and layout.",
        httpClient: { post }
      });
      await provider.extractText(Buffer.from("png"), "image/png", { languageHint: "en-us" });
    });
  });

  it("adds correlation-id header from request context", async () => {
    const post = jest.fn(async (_url: string, _body: unknown, config: { headers: Record<string, string> }) => {
      expect(config.headers["x-correlation-id"]).toBe("corr-123");
      return { data: { rawText: "ok" } };
    });
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await runWithLogContext("corr-123", async () => provider.extractText(Buffer.from("img"), "image/png"));
    expect(post).toHaveBeenCalledTimes(1);
  });

  describe("block & pageImage normalization", () => {
    it("normalizes string confidence and block variants while skipping invalid entries", async () => {
      const post = jest.fn(async () => ({
        data: {
          raw_text: "layout text",
          confidence: "87.5",
          blocks: [
            null,
            {
              label: "Header",
              x1: 1,
              y1: 2,
              x2: 3,
              y2: 4,
              page: "NaN",
              bboxNorm: [10, 20, 30, 40],
              bbox_model: [11, 21, 31, 41],
              type: "heading"
            },
            { text: "Bad length", bbox: [1, 2, 3] },
            { text: "Bad numbers", bbox: [1, 2, "x", 4] }
          ]
        }
      }));

      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("jpg"), "image/jpeg");

      expect(result.confidence).toBe(0.875);
      expect(result.blocks).toEqual([
        {
          text: "Header",
          page: 1,
          bbox: [1, 2, 3, 4],
          bboxNormalized: [10, 20, 30, 40],
          bboxModel: [11, 21, 31, 41],
          blockType: "heading"
        }
      ]);
    });

    it("merges label and text when label is not already in text", async () => {
      const post = jest.fn(async () => ({
        data: {
          rawText: "Invoice Number 42183017",
          blocks: [{ label: "Invoice Number", text: "42183017", bbox: [11, 12, 33, 44] }]
        }
      }));
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("img"), "image/png");
      expect(result.blocks?.[0]?.text).toBe("Invoice Number: 42183017");
    });

    it("maps OCR page images for PDF previews and drops invalid entries", async () => {
      const post = jest.fn(async () => ({
        data: {
          rawText: "layout text",
          confidence: 93,
          pageImages: [
            {
              page: 1,
              mimeType: "image/png",
              width: 2480,
              height: 3508,
              dpi: 300,
              dataUrl: "data:image/png;base64,QUJD"
            },
            { page: 2, mimeType: "image/png", dataUrl: "invalid-data-url" }
          ]
        }
      }));
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");

      expect(result.pageImages).toEqual([
        {
          page: 1,
          mimeType: "image/png",
          width: 2480,
          height: 3508,
          dpi: 300,
          dataUrl: "data:image/png;base64,QUJD"
        }
      ]);
    });

    it.each<{ name: string; bboxKey: "bbox" | "bboxModel" | "bboxNormalized"; input: number[]; expected: number[] }>([
      { name: "bbox", bboxKey: "bbox", input: [300, 400, 100, 200], expected: [100, 200, 300, 400] },
      { name: "bboxModel", bboxKey: "bboxModel", input: [800, 600, 100, 200], expected: [100, 200, 800, 600] },
      { name: "bboxNormalized", bboxKey: "bboxNormalized", input: [0.8, 0.9, 0.1, 0.2], expected: [0.1, 0.2, 0.8, 0.9] }
    ])("auto-corrects inverted coordinates on $name", async ({ bboxKey, input, expected }) => {
      const blockPayload: Record<string, unknown> = {
        text: "x",
        bbox: [10, 20, 30, 40],
        page: 1
      };
      if (bboxKey !== "bbox") blockPayload[bboxKey] = input;
      else blockPayload["bbox"] = input;

      const post = jest.fn(async () => ({
        data: { rawText: "text", blocks: [blockPayload] }
      }));
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("img"), "image/png");
      expect(result.blocks?.[0]?.[bboxKey]).toEqual(expected);
    });

    it.each<{ name: string; bbox: number[] }>([
      { name: "x1 === x2", bbox: [100, 200, 100, 400] },
      { name: "y1 === y2", bbox: [100, 200, 300, 200] }
    ])("rejects zero-area bbox ($name)", async ({ bbox }) => {
      const post = jest.fn(async () => ({
        data: { rawText: "text", blocks: [{ text: "collapsed", bbox, page: 1 }] }
      }));
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("img"), "image/png");
      expect(result.blocks).toBeUndefined();
    });

    it("clamps bboxModel coordinates to the 0-999 range", async () => {
      const post = jest.fn(async () => ({
        data: {
          rawText: "text",
          blocks: [
            { text: "wide", bbox: [10, 20, 30, 40], bboxModel: [-5, 100, 1200, 800], page: 1 }
          ]
        }
      }));
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("img"), "image/png");
      expect(result.blocks?.[0]?.bboxModel).toEqual([0, 100, 999, 800]);
    });
  });

  it("returns empty text for malformed response payload", async () => {
    const post = jest.fn(async () => ({ data: "unexpected" }));
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.text).toBe("");
    expect(result.blocks).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  describe("retry & error handling", () => {
    it.each<{ name: string; error: Record<string, unknown>; successful: boolean }>([
      {
        name: "ECONNREFUSED retries once then succeeds",
        error: { isAxiosError: true, code: "ECONNREFUSED", message: "connect ECONNREFUSED" },
        successful: true
      },
      {
        name: "HTTP 502 retries once then succeeds",
        error: { isAxiosError: true, response: { status: 502 }, message: "Bad gateway" },
        successful: true
      }
    ])("retries transient failures: $name", async ({ error }) => {
      let attempt = 0;
      const post = jest.fn(async () => {
        attempt += 1;
        if (attempt === 1) throw error;
        return { data: { rawText: "recovered" } };
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const result = await provider.extractText(Buffer.from("img"), "image/png");
      expect(post).toHaveBeenCalledTimes(2);
      expect(result.text).toBe("recovered");
    });

    it("does not retry non-retryable HTTP 400 responses", async () => {
      const post = jest.fn(async () => {
        throw {
          isAxiosError: true,
          message: "Request failed with status code 400",
          response: { status: 400, data: { error: { message: "invalid payload" } } }
        };
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
        "deepseek OCR request failed (400): invalid payload"
      );
      expect(post).toHaveBeenCalledTimes(1);
    });

    it("does not retry non-axios failures and wraps the error message", async () => {
      const post = jest.fn(async () => {
        throw new Error("boom");
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
        "deepseek OCR request failed: boom"
      );
      expect(post).toHaveBeenCalledTimes(1);
    });

    it.each<{ name: string; thrown: Record<string, unknown>; expected: string }>([
      {
        name: "top-level message from axios payload",
        thrown: {
          isAxiosError: true,
          message: "Request failed",
          response: { data: { message: "provider overloaded" } }
        },
        expected: "deepseek OCR request failed: provider overloaded"
      },
      {
        name: "detail fallback from axios payload",
        thrown: {
          isAxiosError: true,
          message: "Request failed",
          response: { status: 503, data: { detail: "retry later" } }
        },
        expected: "deepseek OCR request failed (503): retry later"
      },
      {
        name: "axios error message when payload has no usable text",
        thrown: {
          isAxiosError: true,
          message: "socket hang up",
          response: { status: 502, data: { foo: "bar" } }
        },
        expected: "deepseek OCR request failed (502): socket hang up"
      }
    ])("uses best available error message: $name", async ({ thrown, expected }) => {
      const post = jest.fn(async () => {
        throw thrown;
      });
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(expected);
    });
  });

  it("logs OCR token usage when provider returns usage payload", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        rawText: "Invoice Number INV-1",
        usage: {
          prompt_tokens: 123,
          completion_tokens: 45,
          total_tokens: 168
        }
      }
    }));

    try {
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      await provider.extractText(Buffer.from("pdf"), "application/pdf");

      const requestEndCalls = infoSpy.mock.calls.filter((call) => call[0] === "ocr.request.end");
      expect(requestEndCalls).toHaveLength(1);
      expect(requestEndCalls[0]?.[1]).toEqual(
        expect.objectContaining({
          ocrPromptTokens: 123,
          ocrCompletionTokens: 45,
          ocrTotalTokens: 168,
          ocrTokenUsageReturned: true
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
  });
});
