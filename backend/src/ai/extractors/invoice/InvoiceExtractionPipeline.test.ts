import type { FieldVerifier, FieldVerifierInput, FieldVerifierResult } from "@/core/interfaces/FieldVerifier.ts";
import type { OcrBlock, OcrProvider } from "@/core/interfaces/OcrProvider.ts";
import { InvoiceExtractionPipeline } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.ts";
import type { VendorTemplateStore } from "@/ai/extractors/invoice/learning/vendorTemplateStore.ts";

function makeBlock(text: string, bboxNormalized: [number, number, number, number], page = 1): OcrBlock {
  return {
    text,
    page,
    bbox: [0, 0, 100, 20],
    bboxNormalized
  };
}

describe("InvoiceExtractionPipeline", () => {
  it("calls OCR and SLM verifier once, returns parsed invoice data", async () => {
    const extractText = jest.fn(async () => ({
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
    const ocrProvider: OcrProvider = {
      name: "mock-ocr",
      extractText
    };

    const verify = jest.fn(async (_input: FieldVerifierInput): Promise<FieldVerifierResult> => ({
      parsed: {},
      issues: [],
      changedFields: []
    }));
    const fieldVerifier: FieldVerifier = {
      name: "mock-verifier",
      verify
    };

    const templateStore: VendorTemplateStore = {
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

    const pipeline = new InvoiceExtractionPipeline(
      { ocrProvider, fieldVerifier, templateStore },
      { ocrHighConfidenceThreshold: 0.88, llmAssistConfidenceThreshold: 85, ocrDumpEnabled: false }
    );

    const result = await pipeline.extract({
      tenantId: "tenant-1",
      sourceKey: "mailbox-a",
      attachmentName: "invoice.pdf",
      fileBuffer: Buffer.from("sample-content"),
      mimeType: "application/pdf",
      expectedMaxTotal: 200_000,
      expectedMaxDueDays: 90,
      autoSelectMin: 85
    });

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
});
