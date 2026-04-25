export const TRIAGE_REJECT_REASON = {
  NotForAnyClient: "not_for_any_client",
  Spam: "spam",
  WrongVendor: "wrong_vendor",
  Other: "other"
} as const;

export type TriageRejectReason = typeof TRIAGE_REJECT_REASON[keyof typeof TRIAGE_REJECT_REASON];

export interface TriageRejectReasonOption {
  value: TriageRejectReason;
  label: string;
  requiresFreeText: boolean;
}

export const TRIAGE_REJECT_REASON_OPTIONS: TriageRejectReasonOption[] = [
  { value: TRIAGE_REJECT_REASON.NotForAnyClient, label: "Not for any of my clients", requiresFreeText: false },
  { value: TRIAGE_REJECT_REASON.Spam, label: "Spam", requiresFreeText: false },
  { value: TRIAGE_REJECT_REASON.WrongVendor, label: "Wrong vendor", requiresFreeText: false },
  { value: TRIAGE_REJECT_REASON.Other, label: "Other (describe below)", requiresFreeText: true }
];

export interface TriageRejectPayload {
  reasonCode: TriageRejectReason;
  notes?: string;
}

export function buildRejectPayload(
  reason: TriageRejectReason,
  freeText: string
): TriageRejectPayload {
  const trimmed = freeText.trim();
  if (trimmed.length === 0) return { reasonCode: reason };
  return { reasonCode: reason, notes: trimmed };
}

export function rejectReasonLabel(reason: TriageRejectReason): string {
  const option = TRIAGE_REJECT_REASON_OPTIONS.find((opt) => opt.value === reason);
  return option ? option.label : reason;
}
