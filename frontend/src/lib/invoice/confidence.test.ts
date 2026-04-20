import { getConfidenceLabel, getConfidenceTone } from "@/lib/invoice/confidence";

describe("confidence ui helpers", () => {
  it.each([
    ["red below 80", 69, "red"],
    ["yellow at 80", 80, "yellow"],
    ["green at 91", 91, "green"],
  ])("tone: %s", (_label, score, expected) => {
    expect(getConfidenceTone(score)).toBe(expected);
  });

  it.each([
    ["rounds fraction", 95.2, "95%"],
    ["clamps above 100", 102, "100%"],
    ["clamps below 0", -1, "0%"],
  ])("label: %s", (_label, score, expected) => {
    expect(getConfidenceLabel(score)).toBe(expected);
  });
});
