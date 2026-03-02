import type { FieldVerifier, FieldVerifierResult } from "../../core/interfaces/FieldVerifier.ts";
import type { OcrBlock, OcrExtractionOptions, OcrProvider } from "../../core/interfaces/OcrProvider.ts";
import { InvoiceExtractionPipeline, ExtractionPipelineError } from "./InvoiceExtractionPipeline.ts";
import { InMemoryVendorTemplateStore } from "./vendorTemplateStore.ts";

const SAMPLE_TEXT = [
  "Invoice Number: INV-1001",
  "Vendor: ACME Corp",
  "Invoice Date: 2026-02-10",
  "Due Date: 2026-02-18",
  "Currency: USD",
  "Grand Total: 1250.00"
].join("\n");

class StubOcrProvider implements OcrProvider {
  readonly name = "stub-ocr";
  lastRequest:
    | {
        mimeType: string;
        languageHint?: string;
      }
    | undefined;

  constructor(
    private readonly payload: {
      text: string;
      confidence?: number;
      blocks?: OcrBlock[];
      throwError?: boolean;
    }
  ) {}

  async extractText(
    _buffer: Buffer,
    mimeType: string,
    options?: OcrExtractionOptions
  ): Promise<{ text: string; confidence?: number; provider: string; blocks?: OcrBlock[] }> {
    this.lastRequest = {
      mimeType,
      languageHint: options?.languageHint
    };
    if (this.payload.throwError) {
      throw new Error("stub ocr failed");
    }

    return {
      text: this.payload.text,
      confidence: this.payload.confidence,
      provider: this.name,
      blocks: this.payload.blocks
    };
  }
}

class StubFieldVerifier implements FieldVerifier {
  readonly name = "stub-verifier";

  constructor(private readonly result: FieldVerifierResult) {}

  verify = jest.fn(async () => this.result);
}

function buildInput() {
  return {
    tenantId: "tenant-a",
    sourceKey: "folder-a",
    attachmentName: "invoice-a.png",
    fileBuffer: Buffer.from("fake-image-content"),
    mimeType: "image/png",
    expectedMaxTotal: 100000,
    expectedMaxDueDays: 90,
    autoSelectMin: 91,
    referenceDate: new Date("2026-02-20T00:00:00.000Z")
  } as const;
}

describe("InvoiceExtractionPipeline", () => {
  it("uses heuristic extraction and caches template for high-confidence valid invoices", async () => {
    const store = new InMemoryVendorTemplateStore();
    const verifier = new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] });
    const pipeline = new InvoiceExtractionPipeline(
      new StubOcrProvider({
        text: SAMPLE_TEXT,
        confidence: 0.97
      }),
      verifier,
      store
    );

    const result = await pipeline.extract(buildInput());

    expect(result.parseResult.parsed.vendorName).toBe("ACME Corp");
    expect(result.parseResult.parsed.totalAmountMinor).toBe(125000);
    expect(result.metadata.ocrGate).toBe("high");
    expect(result.metadata.documentLanguage).toBe("en");
    expect(result.processingIssues).toEqual([]);
    expect(verifier.verify).not.toHaveBeenCalled();

    const cached = await store.findByFingerprint("tenant-a", result.metadata.vendorFingerprint ?? "");
    expect(cached?.vendorName).toBe("ACME Corp");
  });

  it("invokes verifier in low-confidence mode and merges corrected fields", async () => {
    const store = new InMemoryVendorTemplateStore();
    const verifier = new StubFieldVerifier({
      parsed: {
        totalAmountMinor: 8800,
        currency: "USD"
      },
      issues: [],
      changedFields: ["totalAmountMinor", "currency"]
    });

    const pipeline = new InvoiceExtractionPipeline(
      new StubOcrProvider({
        text: [
          "Invoice Number: INV-2001",
          "Vendor: Delta Services Ltd",
          "Invoice Date: 2026-02-10",
          "Due Date: 2026-02-20"
        ].join("\n"),
        confidence: 0.42,
        blocks: [
          {
            text: "Invoice Number: INV-2001",
            page: 1,
            bbox: [10, 10, 180, 32],
            bboxNormalized: [0.01, 0.01, 0.18, 0.03]
          },
          {
            text: "Vendor: Delta Services Ltd",
            page: 1,
            bbox: [10, 40, 220, 65],
            bboxNormalized: [0.01, 0.04, 0.22, 0.07]
          }
        ]
      }),
      verifier,
      store
    );

    const result = await pipeline.extract(buildInput());

    expect(result.metadata.ocrGate).toBe("low");
    expect(result.metadata.verifier).toBe("stub-verifier");
    expect(result.strategy).toContain("verifier-relaxed");
    expect(result.parseResult.parsed.totalAmountMinor).toBe(8800);
    expect(verifier.verify).toHaveBeenCalledTimes(1);
    expect(verifier.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        ocrText: expect.stringContaining("Invoice Number: INV-2001"),
        ocrBlocks: expect.any(Array),
        hints: expect.objectContaining({
          documentLanguage: "en",
          fieldRegions: expect.any(Object)
        })
      })
    );
  });

  it("short-circuits through vendor template when deterministic validation passes", async () => {
    const store = new InMemoryVendorTemplateStore();
    const previewPipeline = new InvoiceExtractionPipeline(
      new StubOcrProvider({
        text: SAMPLE_TEXT,
        confidence: 0.97
      }),
      new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] }),
      store
    );
    const previewResult = await previewPipeline.extract(buildInput());
    const templateKey = previewResult.metadata.vendorFingerprint ?? "";

    await store.saveOrUpdate({
      tenantId: "tenant-a",
      fingerprintKey: templateKey,
      layoutSignature: previewResult.metadata.layoutSignature ?? "image/png",
      vendorName: "Template Vendor Pvt Ltd",
      currency: "USD",
      invoicePrefix: "TMP",
      confidenceScore: 95
    });

    const verifier = new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] });
    const pipeline = new InvoiceExtractionPipeline(
      new StubOcrProvider({
        text: ["Invoice Number: 55-2", "Currency: USD", "Grand Total: 44.25"].join("\n"),
        confidence: 0.93
      }),
      verifier,
      store
    );

    const result = await pipeline.extract(buildInput());

    expect(result.source).toBe("vendor-template");
    expect(result.strategy).toBe("template-deterministic");
    expect(result.parseResult.parsed.vendorName).toBe("Template Vendor Pvt Ltd");
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("throws FAILED_OCR when OCR produces no usable text", async () => {
    const pipeline = new InvoiceExtractionPipeline(
      new StubOcrProvider({
        text: "",
        confidence: 0.1,
        throwError: true
      }),
      new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] }),
      new InMemoryVendorTemplateStore()
    );

    await expect(pipeline.extract(buildInput())).rejects.toMatchObject<Partial<ExtractionPipelineError>>({
      code: "FAILED_OCR"
    });
  });

  it("passes pre-OCR language hint to OCR provider when file hints are available", async () => {
    const ocrProvider = new StubOcrProvider({
      text: SAMPLE_TEXT,
      confidence: 0.95
    });
    const pipeline = new InvoiceExtractionPipeline(
      ocrProvider,
      new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] }),
      new InMemoryVendorTemplateStore()
    );

    const result = await pipeline.extract({
      ...buildInput(),
      attachmentName: "Facture-client-2026.pdf",
      mimeType: "application/pdf"
    });

    expect(ocrProvider.lastRequest?.languageHint).toBe("fr");
    expect(result.metadata.preOcrLanguage).toBe("fr");
    expect(result.metadata.documentLanguage).toBe("en");
  });

  it("adds OCR key-value grounding candidate when enabled", async () => {
    const ocrProvider = new StubOcrProvider({
      text: "42183017\nUSD 1250.00",
      confidence: 0.93,
      blocks: [
        { text: "Invoice Number", page: 1, bbox: [10, 10, 120, 34], bboxNormalized: [0.02, 0.02, 0.18, 0.04] },
        { text: "42183017", page: 1, bbox: [180, 10, 320, 34], bboxNormalized: [0.19, 0.02, 0.32, 0.04] },
        { text: "Total Amount", page: 1, bbox: [10, 50, 120, 78], bboxNormalized: [0.02, 0.05, 0.18, 0.08] },
        { text: "USD 1250.00", page: 1, bbox: [180, 50, 320, 78], bboxNormalized: [0.19, 0.05, 0.32, 0.08] }
      ]
    });

    const pipeline = new InvoiceExtractionPipeline(
      ocrProvider,
      new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] }),
      new InMemoryVendorTemplateStore(),
      { enableOcrKeyValueGrounding: true }
    );
    const result = await pipeline.extract(buildInput());

    expect(result.attempts.some((attempt) => attempt.source === "ocr-key-value-grounding")).toBe(true);
  });

  it("can disable OCR key-value grounding candidate for baseline benchmarking", async () => {
    const ocrProvider = new StubOcrProvider({
      text: "42183017\nUSD 1250.00",
      confidence: 0.93,
      blocks: [
        { text: "Invoice Number", page: 1, bbox: [10, 10, 120, 34], bboxNormalized: [0.02, 0.02, 0.18, 0.04] },
        { text: "42183017", page: 1, bbox: [180, 10, 320, 34], bboxNormalized: [0.19, 0.02, 0.32, 0.04] }
      ]
    });

    const pipeline = new InvoiceExtractionPipeline(
      ocrProvider,
      new StubFieldVerifier({ parsed: {}, issues: [], changedFields: [] }),
      new InMemoryVendorTemplateStore(),
      { enableOcrKeyValueGrounding: false }
    );
    const result = await pipeline.extract(buildInput());

    expect(result.attempts.some((attempt) => attempt.source === "ocr-key-value-grounding")).toBe(false);
  });
});
