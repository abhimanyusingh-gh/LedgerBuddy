import { clampProbability, clamp, normalizeConfidence } from "@/utils/math.js";

describe("clampProbability", () => {
  it("returns 0 for NaN", () => {
    expect(clampProbability(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(clampProbability(Infinity)).toBe(0);
  });

  it("returns 0 for -Infinity", () => {
    expect(clampProbability(-Infinity)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(clampProbability(-0.5)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(clampProbability(1.5)).toBe(1);
  });

  it("returns the value when within [0, 1]", () => {
    expect(clampProbability(0.5)).toBe(0.5);
  });

  it("returns 0 for exactly 0", () => {
    expect(clampProbability(0)).toBe(0);
  });

  it("returns 1 for exactly 1", () => {
    expect(clampProbability(1)).toBe(1);
  });
});

describe("clamp", () => {
  it("returns value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min when below", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max when above", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns min when value equals min", () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it("returns max when value equals max", () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("works with negative ranges", () => {
    expect(clamp(-15, -10, -5)).toBe(-10);
    expect(clamp(-3, -10, -5)).toBe(-5);
    expect(clamp(-7, -10, -5)).toBe(-7);
  });
});

describe("normalizeConfidence", () => {
  it("returns value in [0,1] as-is with 4-decimal precision", () => {
    expect(normalizeConfidence(0.85)).toBe(0.85);
    expect(normalizeConfidence(0.12345)).toBe(0.1235);
    expect(normalizeConfidence(1)).toBe(1);
  });

  it("treats values > 1 and <= 100 as percentages", () => {
    expect(normalizeConfidence(85)).toBe(0.85);
    expect(normalizeConfidence(100)).toBe(1);
    expect(normalizeConfidence(42.5)).toBe(0.425);
    expect(normalizeConfidence(1.5)).toBe(0.015);
    expect(normalizeConfidence(50)).toBe(0.5);
  });

  it("clamps values > 100 to 1", () => {
    expect(normalizeConfidence(150)).toBe(1);
    expect(normalizeConfidence(200)).toBe(1);
    expect(normalizeConfidence(100.01)).toBe(1);
  });

  it("returns 0 for value = 0", () => {
    expect(normalizeConfidence(0)).toBe(0);
  });

  it("returns 0 for NaN", () => {
    expect(normalizeConfidence(NaN)).toBe(0);
  });

  it("returns 0 for Infinity", () => {
    expect(normalizeConfidence(Infinity)).toBe(0);
  });

  it("returns 0 for -Infinity", () => {
    expect(normalizeConfidence(-Infinity)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(normalizeConfidence(-0.5)).toBe(0);
  });
});
