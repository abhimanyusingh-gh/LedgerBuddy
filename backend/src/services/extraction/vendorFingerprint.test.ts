import { computeVendorFingerprint } from "./vendorFingerprint.ts";

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000a49444154789c6360000000020001e221bc330000000049454e44ae426082",
  "hex"
);

const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEA8QDw8QEA8PDw8PEA8QDxAQFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0fICUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAgMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAAAv/EABQBAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhADEAAAAd4f/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAwEBPwEf/8QAFBEBAAAAAAAAAAAAAAAAAAAAEP/aAAgBAgEBPwEf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQAGPwJf/8QAFBABAAAAAAAAAAAAAAAAAAAAEP/aAAgBAQABPyFf/9k=",
  "base64"
);

describe("computeVendorFingerprint", () => {
  it("produces deterministic keys for PNG images", () => {
    const first = computeVendorFingerprint({
      buffer: TINY_PNG,
      mimeType: "image/png",
      sourceKey: "folder-a",
      attachmentName: "invoice-1.png"
    });
    const second = computeVendorFingerprint({
      buffer: TINY_PNG,
      mimeType: "image/png",
      sourceKey: "folder-a",
      attachmentName: "invoice-1.png"
    });

    expect(first.key).toBe(second.key);
    expect(first.layoutSignature).toContain("image/png");
    expect(first.layoutSignature).toContain("w:1");
    expect(first.layoutSignature).toContain("h:1");
  });

  it("captures jpeg dimensions and source context", () => {
    const first = computeVendorFingerprint({
      buffer: TINY_JPEG,
      mimeType: "image/jpeg",
      sourceKey: "folder-a",
      attachmentName: "invoice-1.jpg"
    });
    const second = computeVendorFingerprint({
      buffer: TINY_JPEG,
      mimeType: "image/jpeg",
      sourceKey: "folder-b",
      attachmentName: "invoice-1.jpg"
    });

    expect(first.layoutSignature).toContain("image/jpeg");
    expect(first.key).not.toBe(second.key);
  });

  it("adds page count hints for pdf inputs", () => {
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n/Type /Page\nendobj\n2 0 obj\n/Type /Page\nendobj");
    const fingerprint = computeVendorFingerprint({
      buffer: pdf,
      mimeType: "application/pdf",
      sourceKey: "folder-a",
      attachmentName: "invoice.pdf"
    });

    expect(fingerprint.layoutSignature).toContain("application/pdf");
    expect(fingerprint.layoutSignature).toContain("pages:2");
    expect(fingerprint.hash.length).toBe(40);
  });
});
