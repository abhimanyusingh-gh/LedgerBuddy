jest.mock("@/services/compliance/clientConfigResolver.js", () => ({
  resolveClientComplianceConfig: jest.fn(async () => null)
}));

import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.ts";
import type { OcrBlock, OcrProvider } from "@/core/interfaces/OcrProvider.ts";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.ts";
import type { VendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.ts";
import { EXTRACTION_SOURCE } from "@/core/engine/extractionSource.ts";
import { resolveClientComplianceConfig } from "@/services/compliance/clientConfigResolver.ts";

function makeBlock(text: string, bboxNormalized: [number, number, number, number], page = 1): OcrBlock {
  return {
    text,
    page,
    bbox: [0, 0, 100, 20],
    bboxNormalized
  };
}

function buildDeps(overrides?: {
  extractText?: jest.Mock;
  verify?: jest.Mock;
  templateStore?: VendorTemplateStore;
}) {
  const extractText = overrides?.extractText ?? jest.fn(async () => ({
    text: [
      "Vendor: Acme Pvt Ltd",
      "Invoice Number: INV-2026-001",
      "Invoice No: INV-2026-ALT",
      "Invoice Date: 12/04/2026",
      "Total Amount: INR 1,234.00"
    ].join("\n"),
    confidence: 0.62,
    provider: "mock-ocr",
    blocks: [
      makeBlock("Vendor: Acme Pvt Ltd", [0.05, 0.06, 0.55, 0.09]),
      makeBlock("Invoice Number: INV-2026-001", [0.05, 0.12, 0.62, 0.15]),
      makeBlock("Invoice No: INV-2026-ALT", [0.05, 0.18, 0.62, 0.21]),
      makeBlock("Invoice Date: 12/04/2026", [0.05, 0.24, 0.5, 0.27]),
      makeBlock("Total Amount: INR 1,234.00", [0.05, 0.3, 0.62, 0.33])
    ]
  }));
  const ocrProvider: OcrProvider = { name: "mock-ocr", extractText };

  const verify = overrides?.verify ?? jest.fn(async (_input: FieldVerifierInput): Promise<FieldVerifierResult> => ({
    parsed: {},
    issues: [],
    changedFields: []
  }));
  const fieldVerifier: FieldVerifier = { name: "mock-verifier", verify };

  const templateStore: VendorTemplateStore = overrides?.templateStore ?? {
    findByFingerprint: jest.fn(async () => ({
      tenantId: "tenant-1",
      clientOrgId: "org-1",
      fingerprintKey: "f-1",
      layoutSignature: "layout-a",
      vendorName: "Acme Pvt Ltd",
      currency: "INR",
      confidenceScore: 0.95
    })),
    saveOrUpdate: jest.fn(async () => undefined)
  };

  return { ocrProvider, fieldVerifier, templateStore, extractText, verify };
}

const defaultInput = {
  tenantId: "tenant-1" as import("@/types/uuid.js").UUID,
  clientOrgId: "507f1f77bcf86cd799439011",
  sourceKey: "mailbox-a",
  attachmentName: "invoice.pdf",
  fileBuffer: Buffer.from("sample-content"),
  mimeType: "application/pdf" as const,
};

describe("InvoiceExtractionPipeline", () => {
  beforeEach(() => {
    (resolveClientComplianceConfig as jest.Mock).mockResolvedValue(null);
  });

  it("routes LlamaExtract through the same post-engine pipeline as SLM", async () => {
    const extractText = jest.fn(async () => ({
      text: "Invoice Number: INV-LLAMA-001\nTotal: 5000.00",
      confidence: 0.88,
      provider: "mock-ocr",
      blocks: [
        makeBlock("Invoice Number: INV-LLAMA-001", [0.05, 0.12, 0.62, 0.15]),
        makeBlock("Total: 5000.00", [0.05, 0.3, 0.62, 0.33])
      ],
      fields: [
        { key: "invoice_number", value: "INV-LLAMA-001" },
        { key: "total_amount", value: "5000.00" },
        { key: "vendor_name", value: "TestVendor LLC" }
      ]
    }));

    const { ocrProvider, fieldVerifier, templateStore } = buildDeps({ extractText });

    const pipeline = new InvoiceExtractionPipeline(
      { ocrProvider, fieldVerifier, templateStore },
    );

    const result = await pipeline.extract(defaultInput);

    expect(result.source).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.strategy).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.extraction?.source).toBe(EXTRACTION_SOURCE.LLAMA_EXTRACT);
    expect(result.parseResult.parsed.invoiceNumber).toBe("INV-LLAMA-001");
    expect(result.parseResult.parsed.vendorName).toBe("TestVendor LLC");
    expect(result.confidenceAssessment).toBeDefined();
    expect(result.provider).toBe("mock-ocr");
  });

  it("decomposed extract delegates to buildContext, runEngine, runPostEnginePipeline", async () => {
    const { ocrProvider, fieldVerifier, templateStore } = buildDeps();

    const pipeline = new InvoiceExtractionPipeline(
      { ocrProvider, fieldVerifier, templateStore },
      {}
    );

    const result = await pipeline.extract(defaultInput);

    expect(result.metadata.vendorFingerprint).toBeTruthy();
    expect(result.metadata.vendorTemplateMatched).toBe("true");
    expect(result.metadata.preOcrLanguage).toBeTruthy();
    expect(result.confidenceAssessment).toBeDefined();
    expect(result.processingIssues).toBeInstanceOf(Array);
  });

  it("uses default learning mode when tenant config returns null", async () => {
    (resolveClientComplianceConfig as jest.Mock).mockResolvedValue(null);

    const { ocrProvider, fieldVerifier, templateStore } = buildDeps();

    const pipeline = new InvoiceExtractionPipeline(
      { ocrProvider, fieldVerifier, templateStore },
      { learningMode: "assistive" }
    );

    const result = await pipeline.extract(defaultInput);

    expect(result.metadata.learningMode).toBe("assistive");
  });
});
