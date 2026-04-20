import { uniqueStrings, escapeRegex, splitTextLines } from "@/utils/text.js";

describe("uniqueStrings", () => {
  it.each([
    ["deduplicates identical strings", ["a", "b", "a"], ["a", "b"]],
    ["trims values before deduplicating", ["  a ", "a", " a"], ["a"]],
    ["filters out empty and whitespace-only strings", ["a", "", "  ", "b"], ["a", "b"]],
    ["returns empty array for empty input", [], []],
    ["preserves order of first occurrence", ["c", "b", "a", "b", "c"], ["c", "b", "a"]],
  ])("%s", (_label, input, expected) => {
    expect(uniqueStrings(input as string[])).toEqual(expected);
  });
});

describe("escapeRegex", () => {
  it("escapes special regex characters so the result matches the input literally", () => {
    const input = "price: $10.00 (total)";
    const escaped = escapeRegex(input);
    expect(new RegExp(escaped).test(input)).toBe(true);
  });

  it("escapes all metacharacters", () => {
    const special = ".*+?^${}()|[]\\";
    const escaped = escapeRegex(special);
    expect(new RegExp(escaped).test(special)).toBe(true);
  });
});

describe("splitTextLines", () => {
  it.each([
    ["splits on newlines", "a\nb\nc", ["a", "b", "c"]],
    ["handles carriage returns", "a\r\nb\rc", ["a", "b", "c"]],
    ["collapses multiple blank lines", "a\n\n\nb", ["a", "b"]],
    ["trims whitespace from each line", "  a  \n  b  ", ["a", "b"]],
    ["filters out empty lines", "\n\n  \n", []],
    ["returns empty array for empty string", "", []],
    ["handles single line with no newline", "hello", ["hello"]],
  ])("%s", (_label, input, expected) => {
    expect(splitTextLines(input as string)).toEqual(expected);
  });
});
