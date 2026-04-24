import { BADGE_TONE, type BadgeTone } from "@/components/ds/Badge";
import type { Invoice } from "@/types";

export const ACTION_REASON = {
  MissingGstin: "MissingGstin",
  FailedOcr: "FailedOcr",
  NeedsReview: "NeedsReview",
  AwaitingApproval: "AwaitingApproval",
  ExportFailed: "ExportFailed",
  CriticalRisk: "CriticalRisk"
} as const;

export type ActionReason = (typeof ACTION_REASON)[keyof typeof ACTION_REASON];

const ACTION_REASON_LABEL: Record<ActionReason, string> = {
  [ACTION_REASON.MissingGstin]: "Missing GSTIN",
  [ACTION_REASON.FailedOcr]: "Blocked — OCR failed",
  [ACTION_REASON.NeedsReview]: "Needs review",
  [ACTION_REASON.AwaitingApproval]: "Awaiting your approval",
  [ACTION_REASON.ExportFailed]: "Export failed",
  [ACTION_REASON.CriticalRisk]: "Critical risk signal"
};

const ACTION_REASON_TONE: Record<ActionReason, BadgeTone> = {
  [ACTION_REASON.MissingGstin]: BADGE_TONE.warning,
  [ACTION_REASON.FailedOcr]: BADGE_TONE.danger,
  [ACTION_REASON.NeedsReview]: BADGE_TONE.warning,
  [ACTION_REASON.AwaitingApproval]: BADGE_TONE.info,
  [ACTION_REASON.ExportFailed]: BADGE_TONE.danger,
  [ACTION_REASON.CriticalRisk]: BADGE_TONE.danger
};

export const ACTION_REASON_SEVERITY: Record<ActionReason, number> = {
  [ACTION_REASON.FailedOcr]: 100,
  [ACTION_REASON.CriticalRisk]: 90,
  [ACTION_REASON.ExportFailed]: 80,
  [ACTION_REASON.MissingGstin]: 70,
  [ACTION_REASON.NeedsReview]: 50,
  [ACTION_REASON.AwaitingApproval]: 30
};

export interface ActionQueueItem {
  invoiceId: string;
  reason: ActionReason;
  invoiceNumber: string | null;
  vendorName: string | null;
  totalAmountMinor: number | null;
  currency: string | null;
  receivedAt: string;
}

export interface ActionQueueGroup {
  reason: ActionReason;
  label: string;
  tone: BadgeTone;
  items: ActionQueueItem[];
}

function classify(invoice: Invoice): ActionReason | null {
  if (invoice.status === "FAILED_OCR" || invoice.status === "FAILED_PARSE") {
    return ACTION_REASON.FailedOcr;
  }
  if (invoice.export?.error) {
    return ACTION_REASON.ExportFailed;
  }
  if (invoice.complianceSummary?.riskSignalMaxSeverity === "critical") {
    return ACTION_REASON.CriticalRisk;
  }
  const currency = invoice.parsed?.currency ?? "INR";
  const missingCustomerGstin =
    currency === "INR" && (invoice.parsed?.customerGstin ?? "").trim() === "";
  if (missingCustomerGstin && invoice.status !== "PENDING") {
    return ACTION_REASON.MissingGstin;
  }
  if (invoice.status === "NEEDS_REVIEW") {
    return ACTION_REASON.NeedsReview;
  }
  if (invoice.status === "AWAITING_APPROVAL") {
    return ACTION_REASON.AwaitingApproval;
  }
  return null;
}

function toQueueItem(invoice: Invoice, reason: ActionReason): ActionQueueItem {
  return {
    invoiceId: invoice._id,
    reason,
    invoiceNumber: invoice.parsed?.invoiceNumber ?? null,
    vendorName: invoice.parsed?.vendorName ?? null,
    totalAmountMinor: invoice.parsed?.totalAmountMinor ?? null,
    currency: invoice.parsed?.currency ?? null,
    receivedAt: invoice.receivedAt
  };
}

export function buildActionQueue(invoices: readonly Invoice[]): ActionQueueGroup[] {
  const groups = new Map<ActionReason, ActionQueueItem[]>();
  for (const invoice of invoices) {
    const reason = classify(invoice);
    if (!reason) continue;
    const existing = groups.get(reason);
    const item = toQueueItem(invoice, reason);
    if (existing) {
      existing.push(item);
    } else {
      groups.set(reason, [item]);
    }
  }
  const ordered: ActionQueueGroup[] = [];
  const reasons = Array.from(groups.keys()).sort(
    (a, b) => ACTION_REASON_SEVERITY[b] - ACTION_REASON_SEVERITY[a]
  );
  for (const reason of reasons) {
    const items = groups.get(reason);
    if (!items || items.length === 0) continue;
    ordered.push({
      reason,
      label: ACTION_REASON_LABEL[reason],
      tone: ACTION_REASON_TONE[reason],
      items: items.slice().sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : -1))
    });
  }
  return ordered;
}

export function totalActionCount(groups: readonly ActionQueueGroup[]): number {
  let total = 0;
  for (const group of groups) total += group.items.length;
  return total;
}
