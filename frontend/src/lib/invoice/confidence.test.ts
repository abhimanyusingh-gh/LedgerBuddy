import { getConfidenceLabel, getConfidenceTone } from "@/lib/invoice/confidence";

describe("confidence ui helpers", () => {
  it("maps score bands to red/yellow/green", () => {
    expect(getConfidenceTone(69)).toBe("red");
    expect(getConfidenceTone(80)).toBe("yellow");
    expect(getConfidenceTone(91)).toBe("green");
  });

  it("formats confidence labels", () => {
    expect(getConfidenceLabel(95.2)).toBe("95%");
    expect(getConfidenceLabel(102)).toBe("100%");
    expect(getConfidenceLabel(-1)).toBe("0%");
  });
});
