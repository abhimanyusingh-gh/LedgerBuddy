import { calibrateDocumentConfidence } from "@/ai/extractors/invoice/confidenceScoring/FieldConfidenceScorer.ts";

describe("calibrateDocumentConfidence", () => {
  it.each<{ name: string; base: number | undefined; raw: string; block: string; score: number }>([
    { name: "empty text short-circuits to 0", base: 0.9, raw: "", block: "", score: 0 },
    { name: "undefined baseConfidence → 0", base: undefined, raw: "Invoice #123", block: "Invoice #123", score: 0 },
    { name: "NaN baseConfidence → 0", base: NaN, raw: "Invoice #123", block: "Invoice #123", score: 0 },
    { name: "Infinity baseConfidence → 0", base: Infinity, raw: "Invoice #123", block: "Invoice #123", score: 0 },
    { name: "-Infinity baseConfidence → 0", base: -Infinity, raw: "Invoice #123", block: "Invoice #123", score: 0 },
    { name: "baseConfidence > 1 clamps to 1", base: 1.5, raw: "Invoice #123", block: "Invoice #123", score: 1 },
    { name: "negative baseConfidence clamps to 0", base: -0.5, raw: "Invoice #123", block: "Invoice #123", score: 0 },
  ])("guards invalid inputs: $name", ({ base, raw, block, score }) => {
    const result = calibrateDocumentConfidence(base, raw, block);
    expect(result.score).toBe(score);
    expect(Number.isFinite(result.lowTokenRatio)).toBe(true);
    expect(Number.isFinite(result.printableRatio)).toBe(true);
  });

  it("returns finite positive score for valid inputs", () => {
    const result = calibrateDocumentConfidence(0.85, "Invoice #123", "Invoice #123");
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });
});
