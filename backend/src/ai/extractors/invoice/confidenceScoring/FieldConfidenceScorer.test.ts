import { calibrateDocumentConfidence } from "@/ai/extractors/invoice/confidenceScoring/FieldConfidenceScorer.ts";

describe("calibrateDocumentConfidence", () => {
  it("returns 0 score for empty text", () => {
    const result = calibrateDocumentConfidence(0.9, "", "");
    expect(result.score).toBe(0);
  });

  it("returns finite score for valid inputs", () => {
    const result = calibrateDocumentConfidence(0.85, "Invoice #123", "Invoice #123");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it("returns 0 score when baseConfidence is undefined", () => {
    const result = calibrateDocumentConfidence(undefined, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(0);
  });

  it("returns 0 score when baseConfidence is NaN", () => {
    const result = calibrateDocumentConfidence(NaN, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(0);
    expect(Number.isFinite(result.lowTokenRatio)).toBe(true);
    expect(Number.isFinite(result.printableRatio)).toBe(true);
  });

  it("returns 0 score when baseConfidence is Infinity", () => {
    const result = calibrateDocumentConfidence(Infinity, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(0);
  });

  it("returns 0 score when baseConfidence is -Infinity", () => {
    const result = calibrateDocumentConfidence(-Infinity, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(0);
  });

  it("clamps baseConfidence above 1 to 1", () => {
    const result = calibrateDocumentConfidence(1.5, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(1);
  });

  it("clamps negative baseConfidence to 0", () => {
    const result = calibrateDocumentConfidence(-0.5, "Invoice #123", "Invoice #123");
    expect(result.score).toBe(0);
  });

  it("all returned values are finite numbers", () => {
    const inputs: Array<[number | undefined, string, string]> = [
      [undefined, "", ""],
      [NaN, "text", "text"],
      [Infinity, "text", "text"],
      [-Infinity, "text", "text"],
      [0.5, "text", "text"],
      [undefined, "text", ""],
      [undefined, "", "text"],
    ];
    for (const [base, raw, block] of inputs) {
      const result = calibrateDocumentConfidence(base, raw, block);
      expect(Number.isFinite(result.score)).toBe(true);
      expect(Number.isFinite(result.lowTokenRatio)).toBe(true);
      expect(Number.isFinite(result.printableRatio)).toBe(true);
    }
  });
});
