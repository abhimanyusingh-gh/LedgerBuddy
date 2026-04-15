import { uniqueStrings, escapeRegex, splitTextLines } from "@/utils/text.js";

describe("uniqueStrings", () => {
  it("deduplicates identical strings", () => {
    expect(uniqueStrings(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("trims values before deduplicating", () => {
    expect(uniqueStrings(["  a ", "a", " a"])).toEqual(["a"]);
  });

  it("filters out empty and whitespace-only strings", () => {
    expect(uniqueStrings(["a", "", "  ", "b"])).toEqual(["a", "b"]);
  });

  it("returns empty array for empty input", () => {
    expect(uniqueStrings([])).toEqual([]);
  });

  it("preserves order of first occurrence", () => {
    expect(uniqueStrings(["c", "b", "a", "b", "c"])).toEqual(["c", "b", "a"]);
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    const input = "price: $10.00 (total)";
    const escaped = escapeRegex(input);
    const regex = new RegExp(escaped);
    expect(regex.test(input)).toBe(true);
  });

  it("escapes all metacharacters", () => {
    const special = ".*+?^${}()|[]\\";
    const escaped = escapeRegex(special);
    expect(new RegExp(escaped).test(special)).toBe(true);
  });

  it("returns plain strings unchanged", () => {
    expect(escapeRegex("hello")).toBe("hello");
  });

  it("handles empty string", () => {
    expect(escapeRegex("")).toBe("");
  });
});

describe("splitTextLines", () => {
  it("splits on newlines", () => {
    expect(splitTextLines("a\nb\nc")).toEqual(["a", "b", "c"]);
  });

  it("handles carriage returns", () => {
    expect(splitTextLines("a\r\nb\rc")).toEqual(["a", "b", "c"]);
  });

  it("collapses multiple blank lines", () => {
    expect(splitTextLines("a\n\n\nb")).toEqual(["a", "b"]);
  });

  it("trims whitespace from each line", () => {
    expect(splitTextLines("  a  \n  b  ")).toEqual(["a", "b"]);
  });

  it("filters out empty lines", () => {
    expect(splitTextLines("\n\n  \n")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(splitTextLines("")).toEqual([]);
  });

  it("handles single line with no newline", () => {
    expect(splitTextLines("hello")).toEqual(["hello"]);
  });
});
