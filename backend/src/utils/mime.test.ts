import { guessMimeTypeFromKey, isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "@/utils/mime.ts";

describe("mime utils", () => {
  it.each([
    ["image/jpg alias", "image/jpg", "image/jpeg"],
    ["image/x-png alias", "image/x-png", "image/png"],
    ["case and whitespace", "  IMAGE/JPEG ", "image/jpeg"],
  ])("normalizeInvoiceMimeType: %s", (_label, input, expected) => {
    expect(normalizeInvoiceMimeType(input)).toBe(expected);
  });

  it.each([
    ["application/pdf", true],
    ["image/jpg", true],
    ["image/png", true],
    ["text/plain", false],
  ])("isSupportedInvoiceMimeType(%s) -> %s", (input, expected) => {
    expect(isSupportedInvoiceMimeType(input as string)).toBe(expected);
  });

  it.each([
    ["uploads/t/abc.pdf", "application/pdf"],
    ["uploads/t/abc.png", "image/png"],
    ["abc.jpg", "image/jpeg"],
    ["abc.jpeg", "image/jpeg"],
    ["abc.webp", "image/webp"],
    ["abc.xyz", "application/octet-stream"],
    ["abc", "application/octet-stream"],
  ])("guessMimeTypeFromKey(%s) -> %s", (input, expected) => {
    expect(guessMimeTypeFromKey(input)).toBe(expected);
  });
});
