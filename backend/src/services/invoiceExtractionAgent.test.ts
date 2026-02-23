import { runInvoiceExtractionAgent } from "./invoiceExtractionAgent.ts";

describe("runInvoiceExtractionAgent", () => {
  it("selects the candidate with stronger invoice signal quality", () => {
    const weakCandidate = [
      "Invoice Number: INV-5001",
      "Vendor: Coastal Supply",
      "Subtotal: 780.00",
      "Tax: 140.40"
    ].join("\n");

    const strongCandidate = [
      "Invoice Number: INV-5001",
      "Vendor: Coastal Supply",
      "Invoice Date: 2026-02-18",
      "Currency: USD",
      "Grand Total: 920.40"
    ].join("\n");

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: weakCandidate, provider: "mock", confidence: 0.97, source: "ocr-provider" },
        { text: strongCandidate, provider: "mock", confidence: 0.88, source: "ocr-provider" }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });

    expect(result.parseResult.parsed.totalAmountMinor).toBe(92040);
    expect(result.parseResult.parsed.currency).toBe("USD");
  });

  it("extracts grounding payload and parses expected invoice fields", () => {
    const noisyOcrText = [
      "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>",
      "Invoice Number: INV-998",
      "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>",
      "Vendor: Delta Services",
      "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>",
      "Currency: USD",
      "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>",
      "Grand Total: 2,450.00"
    ].join("\n");

    const result = runInvoiceExtractionAgent({
      candidates: [{ text: noisyOcrText, provider: "mock", confidence: 0.9, source: "ocr-provider" }],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });

    expect(result.parseResult.parsed.invoiceNumber).toBe("INV-998");
    expect(result.parseResult.parsed.totalAmountMinor).toBe(245000);
    expect(result.attempts.some((attempt) => attempt.strategy === "grounding-text")).toBe(true);
  });
});
