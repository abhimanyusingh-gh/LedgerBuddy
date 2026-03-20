const parseInvoiceTextMock = jest.fn();
const assessInvoiceConfidenceMock = jest.fn();

jest.mock("../parser/invoiceParser.js", () => ({
  parseInvoiceText: (text: string) => parseInvoiceTextMock(text)
}));

jest.mock("./confidenceAssessment.js", () => ({
  assessInvoiceConfidence: (input: unknown) => assessInvoiceConfidenceMock(input)
}));

import { __testables, runInvoiceExtractionAgent } from "./invoiceExtractionAgent.ts";

type ParseShape = {
  parsed: {
    totalAmountMinor?: number;
    invoiceNumber?: string;
    vendorName?: string;
    currency?: string;
    invoiceDate?: string;
  };
  warnings: string[];
};

function defaultConfidence(input: { ocrConfidence?: number }) {
  return {
    score: Number(input.ocrConfidence ?? 0),
    tone: "yellow",
    autoSelectForApproval: false,
    riskFlags: [],
    riskMessages: []
  };
}

describe("runInvoiceExtractionAgent", () => {
  beforeEach(() => {
    parseInvoiceTextMock.mockReset();
    assessInvoiceConfidenceMock.mockReset();
    assessInvoiceConfidenceMock.mockImplementation(defaultConfidence);
  });

  it("selects the candidate with stronger invoice signal quality", () => {
    const weakCandidate = "Invoice Number: INV-5001\nVendor: Coastal Supply\nSubtotal: 780.00\nTax: 140.40";
    const strongCandidate = "Invoice Number: INV-5001\nVendor: Coastal Supply\nInvoice Date: 2026-02-18\nCurrency: USD\nGrand Total: 920.40";

    parseInvoiceTextMock.mockImplementation((text: string) => {
      if (text.includes("Grand Total: 920.40") || text.includes("Currency: USD")) {
        return {
          parsed: { invoiceNumber: "INV-5001", vendorName: "Coastal Supply", invoiceDate: "2026-02-18", currency: "USD", totalAmountMinor: 92040 },
          warnings: []
        };
      }
      return {
        parsed: { invoiceNumber: "INV-5001", vendorName: "Coastal Supply" },
        warnings: ["no_total"]
      };
    });

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

    parseInvoiceTextMock.mockImplementation(() => ({
      parsed: { invoiceNumber: "INV-998", vendorName: "Delta Services", currency: "USD", totalAmountMinor: 245000 },
      warnings: []
    }));

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

describe("runInvoiceExtractionAgent branch coverage", () => {
  beforeEach(() => {
    parseInvoiceTextMock.mockReset();
    assessInvoiceConfidenceMock.mockReset();
    assessInvoiceConfidenceMock.mockImplementation(defaultConfidence);
  });

  it("throws when no non-empty candidates are available", () => {
    parseInvoiceTextMock.mockReturnValue({ parsed: {}, warnings: [] });

    expect(() =>
      runInvoiceExtractionAgent({
        candidates: [{ text: "   ", provider: "p1", source: "s1", confidence: 90 }],
        expectedMaxTotal: 100000,
        expectedMaxDueDays: 90,
        autoSelectMin: 91
      })
    ).toThrow("No OCR text candidates are available for extraction.");
  });

  it("uses confidence score as tie-breaker when total score is equal", () => {
    const parseByText: Record<string, ParseShape> = {
      high_confidence: {
        parsed: { totalAmountMinor: 10000, currency: "USD", invoiceDate: "2026-02-20" },
        warnings: []
      },
      low_confidence: {
        parsed: { totalAmountMinor: 10000, currency: "USD", invoiceDate: "2026-02-20", vendorName: "Vendor" },
        warnings: []
      }
    };
    parseInvoiceTextMock.mockImplementation((text: string) => parseByText[text] ?? { parsed: {}, warnings: [] });

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: "high_confidence", provider: "p1", source: "s1", confidence: 80 },
        { text: "low_confidence", provider: "p2", source: "s2", confidence: 74 }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.provider).toBe("p1");
  });

  it("uses total-amount presence as tie-breaker when score and confidence are equal", () => {
    const parseByText: Record<string, ParseShape> = {
      without_total: {
        parsed: { invoiceNumber: "INV-1", vendorName: "Vendor", currency: "USD", invoiceDate: "2026-02-20" },
        warnings: ["w1", "w2"]
      },
      with_total: {
        parsed: { totalAmountMinor: 10000 },
        warnings: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"]
      }
    };
    parseInvoiceTextMock.mockImplementation((text: string) => parseByText[text] ?? { parsed: {}, warnings: [] });

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: "without_total".repeat(10), provider: "p1", source: "s1", confidence: 50 },
        { text: "with_total", provider: "p2", source: "s2", confidence: 50 }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.provider).toBe("p2");
  });

  it("keeps total-amount preference regardless compare order", () => {
    const parseByText: Record<string, ParseShape> = {
      without_total: {
        parsed: { invoiceNumber: "INV-1", vendorName: "Vendor", currency: "USD", invoiceDate: "2026-02-20" },
        warnings: ["w1", "w2"]
      },
      with_total: {
        parsed: { totalAmountMinor: 10000 },
        warnings: ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"]
      }
    };
    parseInvoiceTextMock.mockImplementation((text: string) => parseByText[text] ?? { parsed: {}, warnings: [] });

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: "with_total", provider: "p2", source: "s2", confidence: 50 },
        { text: "without_total".repeat(10), provider: "p1", source: "s1", confidence: 50 }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.provider).toBe("p2");
  });

  it("uses warning count as tie-breaker when score/confidence/total are equal", () => {
    const parseByText: Record<string, ParseShape> = {
      fewer_warnings: {
        parsed: { totalAmountMinor: 12000, vendorName: "Vendor" },
        warnings: []
      },
      more_warnings: {
        parsed: { totalAmountMinor: 12000, invoiceNumber: "INV-2" },
        warnings: ["w1", "w2"]
      }
    };
    parseInvoiceTextMock.mockImplementation((text: string) => parseByText[text] ?? { parsed: {}, warnings: [] });

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: "more_warnings".repeat(10), provider: "p2", source: "s2", confidence: 44 },
        { text: "fewer_warnings", provider: "p1", source: "s1", confidence: 44 }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.provider).toBe("p1");
  });

  it("uses text length as final tie-breaker", () => {
    const parseShape: ParseShape = {
      parsed: { totalAmountMinor: 12000 },
      warnings: []
    };
    parseInvoiceTextMock.mockReturnValue(parseShape);

    const result = runInvoiceExtractionAgent({
      candidates: [
        { text: "x".repeat(100), provider: "short", source: "s1", confidence: 40 },
        { text: "x".repeat(150), provider: "long", source: "s2", confidence: 40 }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.provider).toBe("long");
  });

  it("expands grounding-text variants and dedupes identical candidates", () => {
    parseInvoiceTextMock.mockReturnValue({
      parsed: { totalAmountMinor: 1000 },
      warnings: []
    });

    const result = runInvoiceExtractionAgent({
      candidates: [
        {
          text: "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>\nInvoice Number: INV-1\n<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>\nGrand Total: 100.00",
          provider: "p1", source: "s1", confidence: 40
        },
        {
          text: "<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>\nInvoice Number: INV-1\n<|ref|>text<|/ref|><|det|>[[1,1,2,2]]<|/det|>\nGrand Total: 100.00",
          provider: "p1", source: "s1", confidence: 40
        }
      ],
      expectedMaxTotal: 100000,
      expectedMaxDueDays: 90,
      autoSelectMin: 91
    });
    expect(result.attempts.length).toBe(2);
  });

  it("covers compareAttempts total and warning tie-break branches directly", () => {
    const baseAttempt = {
      candidate: { text: "x", provider: "p", source: "s", strategy: "raw" },
      score: 10,
      confidence: { score: 50 },
      parseResult: { parsed: {}, warnings: [] }
    };

    const leftWithoutTotal = {
      ...baseAttempt,
      parseResult: { parsed: {}, warnings: [] }
    };
    const rightWithTotal = {
      ...baseAttempt,
      parseResult: { parsed: { totalAmountMinor: 100 }, warnings: [] }
    };

    expect(__testables.compareAttempts(leftWithoutTotal as never, rightWithTotal as never)).toBe(1);
    expect(__testables.compareAttempts(rightWithTotal as never, leftWithoutTotal as never)).toBe(-1);

    const fewerWarnings = {
      ...baseAttempt,
      parseResult: { parsed: { totalAmountMinor: 100 }, warnings: [] }
    };
    const moreWarnings = {
      ...baseAttempt,
      parseResult: { parsed: { totalAmountMinor: 100 }, warnings: ["w1", "w2"] }
    };

    expect(__testables.compareAttempts(fewerWarnings as never, moreWarnings as never)).toBe(-2);
  });
});
