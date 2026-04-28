import {
  TRIAGE_REJECT_REASON,
  TRIAGE_REJECT_REASON_OPTIONS,
  buildRejectPayload,
  rejectReasonLabel
} from "@/features/triage/triageReasons";

describe("features/triage/triageReasons", () => {
  it("flags Other as requiring free text and the others as optional", () => {
    for (const opt of TRIAGE_REJECT_REASON_OPTIONS) {
      expect(opt.requiresFreeText).toBe(opt.value === TRIAGE_REJECT_REASON.Other);
    }
  });

  it("builds a structured payload with reasonCode only when no notes are provided", () => {
    expect(buildRejectPayload(TRIAGE_REJECT_REASON.Spam, "")).toEqual({
      reasonCode: TRIAGE_REJECT_REASON.Spam
    });
    expect(buildRejectPayload(TRIAGE_REJECT_REASON.NotForAnyClient, "   ")).toEqual({
      reasonCode: TRIAGE_REJECT_REASON.NotForAnyClient
    });
  });

  it("includes trimmed notes alongside reasonCode when provided", () => {
    expect(buildRejectPayload(TRIAGE_REJECT_REASON.WrongVendor, "Sent to wrong AP")).toEqual({
      reasonCode: TRIAGE_REJECT_REASON.WrongVendor,
      notes: "Sent to wrong AP"
    });
    expect(buildRejectPayload(TRIAGE_REJECT_REASON.Other, "  Personal email  ")).toEqual({
      reasonCode: TRIAGE_REJECT_REASON.Other,
      notes: "Personal email"
    });
  });

  it("exposes a label lookup for UI display", () => {
    expect(rejectReasonLabel(TRIAGE_REJECT_REASON.Spam)).toBe("Spam");
    expect(rejectReasonLabel(TRIAGE_REJECT_REASON.WrongVendor)).toBe("Wrong vendor");
  });
});
