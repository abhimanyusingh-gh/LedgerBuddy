import type { ComplianceRiskSignal, ParsedInvoiceData, RiskSignalSeverity } from "@/types/invoice.js";
import { toMinorUnits, minorUnitsToMajorString } from "@/utils/currency.js";

const RISK_SIGNAL_PENALTY_CAP = 30;

interface RiskSignalEvaluatorInput {
  parsed: ParsedInvoiceData;
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
}

export class RiskSignalEvaluator {
  evaluate(input: RiskSignalEvaluatorInput): ComplianceRiskSignal[] {
    const signals: ComplianceRiskSignal[] = [];

    this.checkAmountAboveExpected(input, signals);
    this.checkAmountBelowMinimum(input, signals);
    this.checkDueDateTooFar(input, signals);
    this.checkMissingMandatoryFields(input, signals);

    return signals;
  }

  static sumPenalties(signals: ComplianceRiskSignal[]): number {
    const raw = signals.reduce((sum, s) => sum + s.confidencePenalty, 0);
    return Math.min(RISK_SIGNAL_PENALTY_CAP, raw);
  }

  private checkAmountAboveExpected(input: RiskSignalEvaluatorInput, signals: ComplianceRiskSignal[]): void {
    const { parsed, expectedMaxTotal } = input;
    if (
      parsed.totalAmountMinor === undefined ||
      !Number.isInteger(parsed.totalAmountMinor) ||
      expectedMaxTotal <= 0
    ) return;

    const expectedMaxTotalMinor = toMinorUnits(expectedMaxTotal, parsed.currency);
    if (expectedMaxTotalMinor <= 0 || parsed.totalAmountMinor <= expectedMaxTotalMinor) return;

    const currencyPrefix = parsed.currency ? `${parsed.currency} ` : "";
    const overRatio = (parsed.totalAmountMinor - expectedMaxTotalMinor) / expectedMaxTotalMinor;
    const penalty = Math.min(30, Math.round(15 + overRatio * 25));

    signals.push(this.signal(
      "TOTAL_AMOUNT_ABOVE_EXPECTED",
      "financial",
      "warning",
      `Total amount ${currencyPrefix}${minorUnitsToMajorString(parsed.totalAmountMinor, parsed.currency)} exceeds expected max ${currencyPrefix}${minorUnitsToMajorString(expectedMaxTotalMinor, parsed.currency)}.`,
      penalty
    ));
  }

  private checkAmountBelowMinimum(input: RiskSignalEvaluatorInput, signals: ComplianceRiskSignal[]): void {
    const { parsed } = input;
    if (
      parsed.totalAmountMinor === undefined ||
      !Number.isInteger(parsed.totalAmountMinor) ||
      parsed.totalAmountMinor >= 10000
    ) return;

    if (parsed.totalAmountMinor > 0) {
      signals.push(this.signal(
        "TOTAL_AMOUNT_BELOW_MINIMUM",
        "financial",
        "info",
        `Total amount is unusually low (${minorUnitsToMajorString(parsed.totalAmountMinor, parsed.currency)}).`,
        0
      ));
    }
  }

  private checkDueDateTooFar(input: RiskSignalEvaluatorInput, signals: ComplianceRiskSignal[]): void {
    const { parsed, expectedMaxDueDays, referenceDate = new Date() } = input;
    if (!parsed.dueDate || expectedMaxDueDays <= 0) return;

    const dueDate = parsed.dueDate;
    if (isNaN(dueDate.getTime())) return;

    const daysToDue = Math.round(
      (Date.UTC(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()) -
        Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())) / 86400000
    );

    if (daysToDue <= expectedMaxDueDays) return;

    const penalty = Math.min(20, Math.round(8 + (daysToDue - expectedMaxDueDays) / 4));
    signals.push(this.signal(
      "DUE_DATE_TOO_FAR",
      "data-quality",
      "warning",
      `Due date is ${daysToDue} days away, expected max is ${expectedMaxDueDays} days.`,
      penalty
    ));
  }

  private checkMissingMandatoryFields(input: RiskSignalEvaluatorInput, signals: ComplianceRiskSignal[]): void {
    const { parsed } = input;
    const missing: string[] = [];
    if (!parsed.vendorName) missing.push("vendor name");
    if (parsed.totalAmountMinor === undefined || parsed.totalAmountMinor <= 0) missing.push("total amount");

    if (missing.length > 0) {
      signals.push(this.signal(
        "MISSING_MANDATORY_FIELDS",
        "data-quality",
        "warning",
        `Missing mandatory fields: ${missing.join(", ")}.`,
        4
      ));
    }
  }

  private signal(
    code: string,
    category: ComplianceRiskSignal["category"],
    severity: RiskSignalSeverity,
    message: string,
    confidencePenalty: number
  ): ComplianceRiskSignal {
    return {
      code,
      category,
      severity,
      message,
      confidencePenalty,
      status: "open",
      resolvedBy: null,
      resolvedAt: null
    };
  }
}
