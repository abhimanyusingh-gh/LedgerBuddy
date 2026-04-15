import { guessMimeTypeFromKey, isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "@/utils/mime.ts";

describe("mime utils", () => {
  it("normalizes image/jpg alias to image/jpeg", () => {
    expect(normalizeInvoiceMimeType("image/jpg")).toBe("image/jpeg");
  });

  it("normalizes image/x-png alias to image/png", () => {
    expect(normalizeInvoiceMimeType("image/x-png")).toBe("image/png");
  });

  it("normalizes case and whitespace", () => {
    expect(normalizeInvoiceMimeType("  IMAGE/JPEG ")).toBe("image/jpeg");
  });

  it("treats normalized invoice mime types as supported", () => {
    expect(isSupportedInvoiceMimeType("application/pdf")).toBe(true);
    expect(isSupportedInvoiceMimeType("image/jpg")).toBe(true);
    expect(isSupportedInvoiceMimeType("image/png")).toBe(true);
  });

  it("marks unsupported mime types as unsupported", () => {
    expect(isSupportedInvoiceMimeType("text/plain")).toBe(false);
  });

  describe("guessMimeTypeFromKey", () => {
    it("returns application/pdf for .pdf", () => {
      expect(guessMimeTypeFromKey("uploads/t/abc.pdf")).toBe("application/pdf");
    });

    it("returns image/png for .png", () => {
      expect(guessMimeTypeFromKey("uploads/t/abc.png")).toBe("image/png");
    });

    it("returns image/jpeg for .jpg and .jpeg", () => {
      expect(guessMimeTypeFromKey("abc.jpg")).toBe("image/jpeg");
      expect(guessMimeTypeFromKey("abc.jpeg")).toBe("image/jpeg");
    });

    it("returns image/webp for .webp", () => {
      expect(guessMimeTypeFromKey("abc.webp")).toBe("image/webp");
    });

    it("returns octet-stream for unknown extensions", () => {
      expect(guessMimeTypeFromKey("abc.xyz")).toBe("application/octet-stream");
    });

    it("returns octet-stream when no extension", () => {
      expect(guessMimeTypeFromKey("abc")).toBe("application/octet-stream");
    });
  });
});
