import { getInvoiceStatusPresentation } from "@/features/admin/mailboxes/recentIngestionStatus";

const KNOWN_STATUSES = [
  "PENDING",
  "PARSED",
  "NEEDS_REVIEW",
  "AWAITING_APPROVAL",
  "FAILED_OCR",
  "FAILED_PARSE",
  "APPROVED",
  "EXPORTED",
  "PENDING_TRIAGE",
  "REJECTED"
];

describe("features/admin/mailboxes/recentIngestionStatus", () => {
  it("maps every known invoice status to a humanized label and a Badge tone", () => {
    for (const status of KNOWN_STATUSES) {
      const presentation = getInvoiceStatusPresentation(status);
      expect(presentation.label).not.toMatch(/^[A-Z_]+$/);
      expect(presentation.tone).toEqual(expect.any(String));
    }
  });

  it("PARSED resolves to a success-toned `Processed` badge (label sourced from STATUS_LABELS)", () => {
    expect(getInvoiceStatusPresentation("PARSED")).toEqual({
      label: "Processed",
      tone: "success"
    });
  });

  it("PENDING_TRIAGE resolves to a warning-toned `Triage` badge", () => {
    expect(getInvoiceStatusPresentation("PENDING_TRIAGE")).toEqual({
      label: "Triage",
      tone: "warning"
    });
  });

  it("falls back to neutral + `Unknown` when status is null/empty", () => {
    expect(getInvoiceStatusPresentation(null)).toEqual({ label: "Unknown", tone: "neutral" });
    expect(getInvoiceStatusPresentation("")).toEqual({ label: "Unknown", tone: "neutral" });
  });

  it("humanizes unknown SCREAMING_SNAKE_CASE statuses to title-case neutral badges", () => {
    expect(getInvoiceStatusPresentation("WEIRD_NEW_STATE")).toEqual({
      label: "Weird New State",
      tone: "neutral"
    });
  });
});
