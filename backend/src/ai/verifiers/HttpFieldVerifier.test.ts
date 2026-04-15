import { HttpFieldVerifier } from "@/ai/verifiers/HttpFieldVerifier.ts";
import { DOCUMENT_MIME_TYPE, IMAGE_MIME_TYPE } from "@/types/mime.ts";
import { logger } from "@/utils/logger.ts";

describe("HttpFieldVerifier", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("logs verifier token usage when usage payload is present", async () => {
    const infoSpy = jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        parsed: {
          invoiceNumber: "INV-1"
        },
        issues: [],
        changedFields: ["invoiceNumber"],
        usage: {
          prompt_tokens: 90,
          completion_tokens: 30,
          total_tokens: 120
        }
      }
    }));

    const verifier = new HttpFieldVerifier({
      baseUrl: "http://localhost:8100",
      timeoutMs: 5_000,
      httpClient: { post } as never
    });

    const result = await verifier.verify({
      parsed: {},
      ocrText: "Invoice Number INV-1",
      ocrBlocks: [],
      mode: "relaxed",
      hints: {
        mimeType: IMAGE_MIME_TYPE.PNG,
        vendorTemplateMatched: false,
        fieldCandidates: {}
      }
    });

    expect(result.parsed).toEqual({
      invoiceNumber: "INV-1"
    });
    expect(result.changedFields).toEqual(["invoiceNumber"]);

    const requestEndCalls = infoSpy.mock.calls.filter((call) => call[0] === "verifier.http.request.end");
    expect(requestEndCalls).toHaveLength(1);
    expect(requestEndCalls[0]?.[1]).toEqual(
      expect.objectContaining({
        llmPromptTokens: 90,
        llmCompletionTokens: 30,
        llmTotalTokens: 120,
        llmTokenUsageReturned: true
      })
    );
  });

  it("forwards pageImages, llmAssist, and priorCorrections in request body", async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        parsed: { invoiceNumber: "INV-2" },
        issues: [],
        changedFields: ["invoiceNumber"],
        invoiceType: "gst-tax-invoice"
      }
    }));

    const verifier = new HttpFieldVerifier({
      baseUrl: "http://localhost:8100",
      timeoutMs: 5_000,
      httpClient: { post } as never
    });

    const result = await verifier.verify({
      parsed: {},
      ocrText: "Invoice Number INV-2",
      ocrBlocks: [],
      mode: "strict",
      hints: {
        mimeType: IMAGE_MIME_TYPE.PNG,
        vendorTemplateMatched: false,
        fieldCandidates: {},
        pageImages: [{ page: 1, mimeType: IMAGE_MIME_TYPE.PNG, dataUrl: "data:image/png;base64,abc" }],
        llmAssist: true,
        priorCorrections: [{ field: "currency", hint: "INR not USD", count: 2 }]
      }
    });

    expect(result.invoiceType).toBe("gst-tax-invoice");
    const callArgs = post.mock.calls[0] as unknown[];
    const requestBody = callArgs?.[1] as Record<string, unknown>;
    const hints = requestBody?.hints as Record<string, unknown>;
    expect(hints?.pageImages).toHaveLength(1);
    expect(hints?.llmAssist).toBe(true);
    expect(hints?.priorCorrections).toHaveLength(1);
  });

  it("normalizes structured SLM provenance, confidence, and classification fields", async () => {
    jest.spyOn(logger, "info").mockImplementation(() => undefined);
    const post = jest.fn(async () => ({
      data: {
        parsed: {
          invoiceNumber: "INV-3",
          _fieldConfidence: { invoiceNumber: 0.95 },
          _fieldProvenance: {
            invoiceNumber: {
              source: "slm",
              page: 1,
              bboxNormalized: [0.1, 0.2, 0.3, 0.25],
              blockIndex: 4
            }
          },
          _lineItemProvenance: [
            {
              index: 0,
              fields: {
                description: {
                  source: "slm",
                  page: 1,
                  bboxNormalized: [0.08, 0.42, 0.42, 0.46]
                },
                amountMinor: {
                  source: "slm",
                  page: 1,
                  bboxNormalized: [0.73, 0.42, 0.9, 0.46]
                }
              }
            }
          ],
          _classification: {
            invoiceType: "gst-tax-invoice",
            category: "purchase",
            tdsSection: "194C"
          }
        },
        invoiceType: "gst-tax-invoice",
        issues: [],
        changedFields: ["invoiceNumber"]
      }
    }));

    const verifier = new HttpFieldVerifier({
      baseUrl: "http://localhost:8100",
      timeoutMs: 5_000,
      httpClient: { post } as never
    });

    const result = await verifier.verify({
      parsed: {},
      ocrText: "Invoice Number INV-3",
      ocrBlocks: [],
      mode: "relaxed",
      hints: {
        mimeType: DOCUMENT_MIME_TYPE.PDF,
        vendorTemplateMatched: false,
        fieldCandidates: {}
      }
    });

    expect(result.fieldConfidence).toEqual({ invoiceNumber: 0.95 });
    expect(result.fieldProvenance?.invoiceNumber).toEqual(
      expect.objectContaining({
        source: "slm",
        page: 1,
        bboxNormalized: [0.1, 0.2, 0.3, 0.25],
        blockIndex: 4
      })
    );
    expect(result.lineItemProvenance).toHaveLength(1);
    expect(result.classification).toEqual({
      invoiceType: "gst-tax-invoice",
      category: "purchase",
      tdsSection: "194C"
    });
  });

  it("throws when verifier request fails (SLM is mandatory)", async () => {
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => undefined);
    const post = jest.fn(async () => {
      throw new Error("connection refused");
    });
    const verifier = new HttpFieldVerifier({
      baseUrl: "http://localhost:8100",
      timeoutMs: 5_000,
      httpClient: { post } as never
    });
    const input = {
      parsed: {
        vendorName: "ACME"
      },
      ocrText: "Vendor ACME",
      ocrBlocks: [],
      mode: "strict" as const,
      hints: {
        mimeType: IMAGE_MIME_TYPE.PNG,
        vendorTemplateMatched: false,
        fieldCandidates: {}
      }
    };

    await expect(verifier.verify(input)).rejects.toThrow("SLM verification failed after 3 attempts: connection refused");
    expect(errorSpy).toHaveBeenCalledWith(
      "verifier.http.failed",
      expect.objectContaining({
        error: "connection refused"
      })
    );
  });
});
