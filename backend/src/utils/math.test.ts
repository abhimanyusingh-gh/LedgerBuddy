import { clampProbability, clamp } from "@/utils/math.js";

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
