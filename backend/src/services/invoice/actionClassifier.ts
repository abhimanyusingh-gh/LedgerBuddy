import {
  INVOICE_STATUS,
  RISK_SIGNAL_SEVERITY,
  RISK_SIGNAL_STATUS,
  type InvoiceStatus,
  type RiskSignalSeverity,
  type RiskSignalStatus
} from "@/types/invoice.js";

export const ACTION_REASON = {
  MissingGstin: "MissingGstin",
  FailedOcr: "FailedOcr",
  NeedsReview: "NeedsReview",
  AwaitingApproval: "AwaitingApproval",
  ExportFailed: "ExportFailed",
  CriticalRisk: "CriticalRisk"
} as const;

export type ActionReason = (typeof ACTION_REASON)[keyof typeof ACTION_REASON];

export const ACTION_REASON_SEVERITY: Record<ActionReason, number> = {
  [ACTION_REASON.FailedOcr]: 100,
  [ACTION_REASON.CriticalRisk]: 90,
  [ACTION_REASON.ExportFailed]: 80,
  [ACTION_REASON.MissingGstin]: 70,
  [ACTION_REASON.NeedsReview]: 50,
  [ACTION_REASON.AwaitingApproval]: 30
};

export interface ClassifierInput {
  status: InvoiceStatus | string;
  parsed?: {
    currency?: string | null;
    customerGstin?: string | null;
  } | null;
  export?: { error?: string | null } | null;
  compliance?: {
    riskSignals?: Array<{
      severity: RiskSignalSeverity | string;
      status: RiskSignalStatus | string;
    }> | null;
  } | null;
}

export function classifyActionReason(invoice: ClassifierInput): ActionReason | null {
  if (invoice.status === INVOICE_STATUS.FAILED_OCR || invoice.status === INVOICE_STATUS.FAILED_PARSE) {
    return ACTION_REASON.FailedOcr;
  }
  if (typeof invoice.export?.error === "string" && invoice.export.error.length > 0) {
    return ACTION_REASON.ExportFailed;
  }
  const openCritical = (invoice.compliance?.riskSignals ?? []).some(
    (s) => s.status === RISK_SIGNAL_STATUS.OPEN && s.severity === RISK_SIGNAL_SEVERITY.CRITICAL
  );
  if (openCritical) {
    return ACTION_REASON.CriticalRisk;
  }
  const currency = invoice.parsed?.currency ?? "INR";
  const customerGstin = (invoice.parsed?.customerGstin ?? "").trim();
  if (currency === "INR" && customerGstin === "" && invoice.status !== INVOICE_STATUS.PENDING) {
    return ACTION_REASON.MissingGstin;
  }
  if (invoice.status === INVOICE_STATUS.NEEDS_REVIEW) {
    return ACTION_REASON.NeedsReview;
  }
  if (invoice.status === INVOICE_STATUS.AWAITING_APPROVAL) {
    return ACTION_REASON.AwaitingApproval;
  }
  return null;
}

interface ActionSeverityFields {
  actionReason: ActionReason | null;
  actionSeverity: number | null;
}

export function computeActionSeverityFields(invoice: ClassifierInput): ActionSeverityFields {
  const reason = classifyActionReason(invoice);
  if (reason === null) {
    return { actionReason: null, actionSeverity: null };
  }
  return { actionReason: reason, actionSeverity: ACTION_REASON_SEVERITY[reason] };
}

export function emptyReasonCounts(): Record<ActionReason, number> {
  return {
    [ACTION_REASON.FailedOcr]: 0,
    [ACTION_REASON.CriticalRisk]: 0,
    [ACTION_REASON.ExportFailed]: 0,
    [ACTION_REASON.MissingGstin]: 0,
    [ACTION_REASON.NeedsReview]: 0,
    [ACTION_REASON.AwaitingApproval]: 0
  };
}
