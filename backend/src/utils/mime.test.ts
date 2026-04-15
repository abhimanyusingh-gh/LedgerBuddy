import { isSupportedInvoiceMimeType, normalizeInvoiceMimeType } from "@/utils/mime.ts";

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
});
