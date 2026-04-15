jest.mock("@/models/integration/TenantComplianceConfig.js", () => ({
  TenantComplianceConfigModel: {
    findOne: jest.fn(() => ({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null)
      })
    }))
  }
}));

import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.ts";
import type { OcrBlock, OcrProvider } from "@/core/interfaces/OcrProvider.ts";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.ts";
import type { VendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.ts";
import { EXTRACTION_SOURCE } from "@/core/engine/extractionSource.ts";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig.ts";

jest.mock("@/models/integration/TenantComplianceConfig.ts");

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
  sourceKey: "mailbox-a",
  attachmentName: "invoice.pdf",
  fileBuffer: Buffer.from("sample-content"),
  mimeType: "application/pdf" as const,
};

describe("InvoiceExtractionPipeline", () => {
  beforeEach(() => {
    const chainable = { lean: jest.fn().mockResolvedValue(null) };
    (TenantComplianceConfigModel.findOne as jest.Mock).mockReturnValue({
      select: jest.fn().mockReturnValue(chainable),
      lean: chainable.lean
    });
  });

  it("calls OCR and SLM verifier once, returns parsed invoice data", async () => {
    const { ocrProvider, fieldVerifier, templateStore, extractText, verify } = buildDeps();

    const pipeline = new InvoiceExtractionPipeline(
      { ocrProvider, fieldVerifier, templateStore },
      {}
    );

    const result = await pipeline.extract(defaultInput);

    expect(extractText).toHaveBeenCalledWith(
      expect.any(Buffer),
      "application/pdf",
      expect.objectContaining({ languageHint: "en" })
    );

    expect(verify).toHaveBeenCalledTimes(1);
    const verifierInput = verify.mock.calls[0]?.[0] as FieldVerifierInput;
    expect(typeof verifierInput.ocrText).toBe("string");
    expect(verifierInput.ocrText.length).toBeGreaterThan(0);

    expect(result.parseResult.parsed.invoiceNumber).toBe("INV-2026-001");
    expect(result.parseResult.parsed.totalAmountMinor).toBe(123400);
    expect(result.metadata.ocrPrimaryVariant).toBeTruthy();
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
      { llamaExtractEnabled: true }
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
});
