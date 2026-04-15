import { DeepSeekOcrProvider } from "@/ai/ocr/DeepSeekOcrProvider.ts";
import { runWithLogContext } from "@/utils/logger.ts";
import { logger } from "@/utils/logger.ts";
import axios from "axios";

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
    await expect(provider.extractText(Buffer.from("x"), "text/plain")).resolves.toEqual({
      text: "",
      confidence: 0,
      provider: "deepseek"
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("calls /ocr/document without authorization header when api key is empty", async () => {
    const post = jest.fn(async (_url: string, body: { includeLayout: boolean; prompt: string }, config: { headers: Record<string, string> }) => {
      expect(body.includeLayout).toBe(true);
      expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
      expect(body.prompt).not.toContain("Key-Value Pairs");
      expect(config.headers.Authorization).toBeUndefined();
      return {
        data: {
          rawText: "invoice text",
          confidence: 80
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ apiKey: "", httpClient: { post } });
    const result = await provider.extractText(Buffer.from("png"), "image/png");
    expect(result.text).toBe("invoice text");
    expect(result.confidence).toBe(0.8);
  });

  it("strips image placeholders from configured OCR prompt", async () => {
    const post = jest.fn(async (_url: string, body: { prompt: string }) => {
      expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
      expect(body.prompt).not.toContain("<image>");
      expect(body.prompt).not.toContain("<|image_1|>");
      return {
        data: {
          rawText: "invoice text"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({
      prompt: "<image>\nTranscribe all visible text exactly as written. Preserve numbers and layout. <|image_1|>",
      httpClient: { post }
    });

    await provider.extractText(Buffer.from("png"), "image/png");
  });

  it("appends language hint to OCR prompt when provided", async () => {
    const post = jest.fn(async (_url: string, body: { prompt: string }) => {
      expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
      expect(body.prompt).toContain("Document language hint: fr. Preserve native language.");
      return {
        data: {
          rawText: "invoice text"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({
      prompt: "Transcribe all visible text exactly as written. Preserve numbers and layout.",
      httpClient: { post }
    });

    await provider.extractText(Buffer.from("png"), "image/png", { languageHint: "fr" });
  });

  it("ignores invalid language hint values in OCR prompt", async () => {
    const post = jest.fn(async (_url: string, body: { prompt: string }) => {
      expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
      expect(body.prompt).not.toContain("Document language hint:");
      return {
        data: {
          rawText: "invoice text"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({
      prompt: "Transcribe all visible text exactly as written. Preserve numbers and layout.",
      httpClient: { post }
    });

    await provider.extractText(Buffer.from("png"), "image/png", { languageHint: "en-us" });
  });

  it("keeps transcription-only prompt even when legacy key-value option is provided", async () => {
    const post = jest.fn(async (_url: string, body: { prompt: string }) => {
      expect(body.prompt).toBe("Transcribe all visible text exactly as written. Preserve numbers and layout.");
      return {
        data: {
          rawText: "invoice text"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({
      prompt: "Transcribe all visible text exactly as written. Preserve numbers and layout.",
      enforceKeyValuePairs: false,
      httpClient: { post }
    });

    await provider.extractText(Buffer.from("png"), "image/png");
  });

  it("adds authorization header when api key is provided", async () => {
    const post = jest.fn(async (_url: string, _body: unknown, config: { headers: Record<string, string> }) => {
      expect(config.headers.Authorization).toBe("Bearer local-key");
      return {
        data: {
          rawText: "invoice text"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ apiKey: "local-key", httpClient: { post } });
    await provider.extractText(Buffer.from("png"), "image/png");
  });

  it("creates an axios client when http client override is not provided", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "ok"
      }
    }));
    const createSpy = jest.spyOn(axios, "create").mockReturnValue({ post } as never);

    try {
      const provider = new DeepSeekOcrProvider({ baseUrl: "http://local-ocr:8000/v1" });
      await provider.extractText(Buffer.from("img"), "image/png");
      expect(createSpy).toHaveBeenCalledWith({ baseURL: "http://local-ocr:8000/v1" });
    } finally {
      createSpy.mockRestore();
    }
  });

  it("adds correlation-id header from request context", async () => {
    const post = jest.fn(async (_url: string, _body: unknown, config: { headers: Record<string, string> }) => {
      expect(config.headers["x-correlation-id"]).toBe("corr-123");
      return {
        data: {
          rawText: "ok"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await runWithLogContext("corr-123", async () => provider.extractText(Buffer.from("img"), "image/png"));
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("keeps includeLayout=true for pdf files to request block-level OCR", async () => {
    const post = jest.fn(async (_url: string, body: { includeLayout: boolean }) => {
      expect(body.includeLayout).toBe(true);
      return {
        data: {
          raw_text: "pdf text",
          confidence: 0.92
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");
    expect(result.text).toBe("pdf text");
    expect(result.confidence).toBe(0.92);
  });

  it("maps blocks including bboxModel and drops invalid block rows", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "layout text",
        confidence: 93,
        blocks: [
          {
            text: "Vendor",
            page: 1,
            bbox: [10, 20, 30, 40],
            bboxNormalized: [100, 200, 300, 400],
            bboxModel: [100.5, 200.5, 300.5, 400.5],
            blockType: "text"
          },
          {
            text: "",
            bbox: [1, 2, 3, 4]
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("jpg"), "image/jpeg");

    expect(result.confidence).toBe(0.93);
    expect(result.blocks).toEqual([
      {
        text: "Vendor",
        page: 1,
        bbox: [10, 20, 30, 40],
        bboxNormalized: [100, 200, 300, 400],
        bboxModel: [100.5, 200.5, 300.5, 400.5],
        blockType: "text"
      }
    ]);
  });

  it("maps OCR page images for PDF previews", async () => {
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
          {
            page: 2,
            mimeType: "image/png",
            dataUrl: "invalid-data-url"
          }
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

  it("ignores malformed token-usage counts", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        rawText: "Invoice Number INV-1",
        usage: {
          prompt_tokens: true,
          completion_tokens: "NaN",
          total_tokens: -5
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
          ocrPromptTokens: undefined,
          ocrCompletionTokens: undefined,
          ocrTotalTokens: undefined,
          ocrTokenUsageReturned: false
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("logs approximate OCR output tokens when provider omits usage payload", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        rawText: "Invoice Number INV-2"
      }
    }));

    try {
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      await provider.extractText(Buffer.from("pdf"), "application/pdf");

      const requestEndCalls = infoSpy.mock.calls.filter((call) => call[0] === "ocr.request.end");
      expect(requestEndCalls).toHaveLength(1);
      expect(requestEndCalls[0]?.[1]).toEqual(
        expect.objectContaining({
          ocrPromptTokens: undefined,
          ocrCompletionTokens: undefined,
          ocrTotalTokens: undefined,
          ocrTokenUsageReturned: false,
          ocrOutputTokensApprox: 3
        })
      );
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("skips non-object page image entries and ignores non-numeric dimensions", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "layout text",
        pageImages: [
          1,
          {
            page: 3,
            mimeType: "image/png",
            width: "not-a-number",
            dataUrl: "data:image/png;base64,QUJD"
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");

    expect(result.pageImages).toEqual([
      {
        page: 3,
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,QUJD"
      }
    ]);
  });

  it("defaults page image mime type and drops zero dimensions", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "layout text",
        pageImages: [
          {
            page: 2,
            width: 0,
            dataUrl: "data:image/png;base64,QUJD"
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");

    expect(result.pageImages).toEqual([
      {
        page: 2,
        mimeType: "image/png",
        dataUrl: "data:image/png;base64,QUJD"
      }
    ]);
  });

  it("returns undefined page images when all entries are invalid", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "layout text",
        pageImages: [{ page: 1, dataUrl: "invalid" }, 42]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("pdf"), "application/pdf");

    expect(result.pageImages).toBeUndefined();
  });

  it("returns empty text for malformed response payload", async () => {
    const post = jest.fn(async () => ({
      data: "unexpected"
    }));
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.text).toBe("");
    expect(result.blocks).toBeUndefined();
    expect(result.confidence).toBeUndefined();
  });

  it("uses empty text when payload text fields are blank", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "   ",
        raw_text: "   "
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.text).toBe("");
  });

  it("retries transient network errors and succeeds", async () => {
    let attempt = 0;
    const post = jest.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw {
          isAxiosError: true,
          code: "ECONNREFUSED",
          message: "connect ECONNREFUSED"
        };
      }
      return {
        data: {
          rawText: "recovered",
          confidence: 0.91
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(post).toHaveBeenCalledTimes(2);
    expect(result.text).toBe("recovered");
  });

  it("retries retryable 5xx errors and applies backoff outside test mode", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    jest.useFakeTimers();
    const timeoutSpy = jest.spyOn(global, "setTimeout");

    let attempt = 0;
    const post = jest.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw {
          isAxiosError: true,
          response: {
            status: 502
          },
          message: "Bad gateway"
        };
      }
      return {
        data: {
          rawText: "ok"
        }
      };
    });

    try {
      const provider = new DeepSeekOcrProvider({ httpClient: { post } });
      const resultPromise = provider.extractText(Buffer.from("img"), "image/png");
      await jest.runOnlyPendingTimersAsync();
      const result = await resultPromise;
      expect(post).toHaveBeenCalledTimes(2);
      expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), expect.any(Number));
      expect(result.text).toBe("ok");
    } finally {
      timeoutSpy.mockRestore();
      jest.useRealTimers();
      process.env.NODE_ENV = previousNodeEnv;
    }
  });

  it("does not retry non-retryable HTTP 400 responses", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "Request failed with status code 400",
        response: {
          status: 400,
          data: {
            error: {
              message: "invalid payload"
            }
          }
        }
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

  it("wraps non-error thrown values", async () => {
    const post = jest.fn(async () => {
      throw "boom";
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
      "deepseek OCR request failed: boom"
    );
  });

  it("uses top-level message from axios payload when present", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "Request failed",
        response: {
          data: {
            message: "provider overloaded"
          }
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
      "deepseek OCR request failed: provider overloaded"
    );
  });

  it("uses detail message fallback from axios payload", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "Request failed",
        response: {
          status: 503,
          data: {
            detail: "retry later"
          }
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
      "deepseek OCR request failed (503): retry later"
    );
  });

  it("falls back to axios error message when response payload has no usable message", async () => {
    const post = jest.fn(async () => {
      throw {
        isAxiosError: true,
        message: "socket hang up",
        response: {
          status: 502,
          data: {
            foo: "bar"
          }
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await expect(provider.extractText(Buffer.from("img"), "image/png")).rejects.toThrow(
      "deepseek OCR request failed (502): socket hang up"
    );
  });

  it("uses default timeout when env timeout is invalid", async () => {
    process.env.OCR_TIMEOUT_MS = "oops";
    const post = jest.fn(async (_url: string, _body: unknown, config: { timeout: number }) => {
      expect(config.timeout).toBe(3600000);
      return {
        data: {
          rawText: "ok"
        }
      };
    });
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await provider.extractText(Buffer.from("img"), "image/png");
  });

  it("uses env timeout when it is valid", async () => {
    process.env.OCR_TIMEOUT_MS = "1234";
    const post = jest.fn(async (_url: string, _body: unknown, config: { timeout: number }) => {
      expect(config.timeout).toBe(1234);
      return {
        data: {
          rawText: "ok"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await provider.extractText(Buffer.from("img"), "image/png");
  });

  it("uses env max token override when valid", async () => {
    process.env.OCR_MAX_TOKENS = "777";
    const post = jest.fn(async (_url: string, body: { maxTokens: number }) => {
      expect(body.maxTokens).toBe(777);
      return {
        data: {
          rawText: "ok"
        }
      };
    });
    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    await provider.extractText(Buffer.from("img"), "image/png");
  });

  it("falls back to default max tokens when env override is invalid", async () => {
    process.env.OCR_MAX_TOKENS = "NaN";
    const post = jest.fn(async (_url: string, body: { maxTokens: number; prompt: string }) => {
      expect(body.maxTokens).toBe(2048);
      expect(body.prompt).toContain("Transcribe all visible text exactly as written.");
      return {
        data: {
          rawText: "ok"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ prompt: "   ", httpClient: { post } });
    await provider.extractText(Buffer.from("img"), "image/png");
  });

  it("falls back to default max tokens when override is invalid", async () => {
    const post = jest.fn(async (_url: string, body: { maxTokens: number }) => {
      expect(body.maxTokens).toBe(2048);
      return {
        data: {
          rawText: "ok"
        }
      };
    });

    const provider = new DeepSeekOcrProvider({ maxTokens: -1, httpClient: { post } });
    await provider.extractText(Buffer.from("img"), "image/png");
  });

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
          {
            text: "Bad length",
            bbox: [1, 2, 3]
          },
          {
            text: "Bad numbers",
            bbox: [1, 2, "x", 4]
          }
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

  it("merges label and value when both are present in OCR block payload", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "Invoice Number 42183017",
        blocks: [
          {
            label: "Invoice Number",
            text: "42183017",
            bbox: [11, 12, 33, 44]
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");

    expect(result.blocks).toEqual([
      {
        text: "Invoice Number: 42183017",
        page: 1,
        bbox: [11, 12, 33, 44]
      }
    ]);
  });

  it("keeps raw block text when label is already present in the text", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "Invoice Number: 42183017",
        blocks: [
          {
            label: "Invoice Number",
            text: "Invoice Number: 42183017",
            bbox: [11, 12, 33, 44]
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");

    expect(result.blocks).toEqual([
      {
        text: "Invoice Number: 42183017",
        page: 1,
        bbox: [11, 12, 33, 44]
      }
    ]);
  });

  it("normalizes non-positive page numbers and ignores invalid confidence values", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "x",
        confidence: "not-a-number",
        blocks: [
          {
            text: "Missing bbox"
          },
          {
            text: "Non positive page",
            bbox: [1, 2, 3, 4],
            page: 0
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.confidence).toBeUndefined();
    expect(result.blocks).toEqual([
      {
        text: "Non positive page",
        page: 1,
        bbox: [1, 2, 3, 4]
      }
    ]);
  });

  it("returns undefined blocks when all OCR block rows are invalid", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "x",
        blocks: [
          null,
          {
            text: "",
            bbox: [1, 2, 3, 4]
          },
          {
            text: "bad-length",
            bbox: [1, 2, 3]
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks).toBeUndefined();
  });

  it("auto-corrects inverted coordinate order in bbox", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Vendor Name",
            bbox: [300, 400, 100, 200],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks![0].bbox).toEqual([100, 200, 300, 400]);
  });

  it("rejects zero-area bbox where x1 equals x2", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Collapsed box",
            bbox: [100, 200, 100, 400],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks).toBeUndefined();
  });

  it("rejects zero-area bbox where y1 equals y2", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Flat box",
            bbox: [100, 200, 300, 200],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks).toBeUndefined();
  });

  it("clamps bboxModel coordinates to 0-999 range", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Wide box",
            bbox: [10, 20, 30, 40],
            bboxModel: [-5, 100, 1200, 800],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks![0].bboxModel).toEqual([0, 100, 999, 800]);
  });

  it("auto-corrects inverted bboxModel coordinate order", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Inverted model",
            bbox: [10, 20, 30, 40],
            bboxModel: [800, 600, 100, 200],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks![0].bboxModel).toEqual([100, 200, 800, 600]);
  });

  it("auto-corrects inverted bboxNormalized coordinate order", async () => {
    const post = jest.fn(async () => ({
      data: {
        rawText: "text",
        blocks: [
          {
            text: "Inverted normalized",
            bbox: [10, 20, 30, 40],
            bboxNormalized: [0.8, 0.9, 0.1, 0.2],
            page: 1
          }
        ]
      }
    }));

    const provider = new DeepSeekOcrProvider({ httpClient: { post } });
    const result = await provider.extractText(Buffer.from("img"), "image/png");
    expect(result.blocks![0].bboxNormalized).toEqual([0.1, 0.2, 0.8, 0.9]);
  });
});
