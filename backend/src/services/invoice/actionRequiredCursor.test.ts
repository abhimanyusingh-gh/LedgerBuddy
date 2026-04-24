import {
  ActionRequiredCursorError,
  decodeActionRequiredCursor,
  encodeActionRequiredCursor,
  type ActionRequiredCursor
} from "./actionRequiredCursor.ts";

describe("actionRequiredCursor", () => {
  const sample: ActionRequiredCursor = {
    lastSeverity: 70,
    lastCreatedAt: "2026-04-22T12:00:00.000Z",
    lastInvoiceId: "507f1f77bcf86cd799439011"
  };

  it("round-trips encoded cursor", () => {
    const encoded = encodeActionRequiredCursor(sample);
    expect(decodeActionRequiredCursor(encoded)).toEqual(sample);
  });

  it("produces base64url-safe strings (no padding, no +, no /)", () => {
    const encoded = encodeActionRequiredCursor(sample);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it.each([
    ["garbage string", "not-base64!!"],
    ["empty string", ""],
    ["base64 of non-json", Buffer.from("plain text").toString("base64url")],
    ["base64 of non-object json", Buffer.from("42").toString("base64url")],
    ["missing lastSeverity", Buffer.from(JSON.stringify({ lastCreatedAt: sample.lastCreatedAt, lastInvoiceId: sample.lastInvoiceId })).toString("base64url")],
    ["invalid date", Buffer.from(JSON.stringify({ ...sample, lastCreatedAt: "not-a-date" })).toString("base64url")],
    ["empty invoiceId", Buffer.from(JSON.stringify({ ...sample, lastInvoiceId: "" })).toString("base64url")],
    ["non-hex invoiceId", Buffer.from(JSON.stringify({ ...sample, lastInvoiceId: "not-an-object-id" })).toString("base64url")],
    ["short hex invoiceId", Buffer.from(JSON.stringify({ ...sample, lastInvoiceId: "abc123" })).toString("base64url")]
  ])("rejects %s", (_label, input) => {
    expect(() => decodeActionRequiredCursor(input)).toThrow(ActionRequiredCursorError);
  });
});
