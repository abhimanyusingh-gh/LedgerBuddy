import type { ParsedInvoiceData } from "../../types/invoice.js";

const ADDRESS_SIGNAL_PATTERN =
  /\b(address|warehouse|village|road|street|avenue|taluk|district|state|country|postal|pin|zipcode)\b/i;

interface DeterministicValidationInput {
  parsed: ParsedInvoiceData;
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
}

interface DeterministicValidationResult {
  valid: boolean;
  issues: string[];
}

export function validateInvoiceFields(input: DeterministicValidationInput): DeterministicValidationResult {
  const issues: string[] = [];
  const parsed = input.parsed;

  if (!parsed.invoiceNumber) {
    issues.push("Invoice number is missing.");
  }

  if (!parsed.vendorName) {
    issues.push("Vendor name is missing.");
  } else if (ADDRESS_SIGNAL_PATTERN.test(parsed.vendorName)) {
    issues.push("Vendor name looks like an address line.");
  }

  if (!parsed.currency) {
    issues.push("Currency is missing.");
  }

  if (!Number.isInteger(parsed.totalAmountMinor) || (parsed.totalAmountMinor ?? 0) <= 0) {
    issues.push("Total amount is missing or invalid.");
  } else {
    const hardMax = Math.round(Math.max(1, input.expectedMaxTotal) * 100);
    if ((parsed.totalAmountMinor ?? 0) > hardMax) {
      issues.push("Total amount exceeds configured expected maximum.");
    }
  }

  const invoiceDate = parseIsoDate(parsed.invoiceDate);
  const dueDate = parseIsoDate(parsed.dueDate);
  if (invoiceDate && dueDate) {
    if (dueDate.getTime() < invoiceDate.getTime()) {
      issues.push("Due date is earlier than invoice date.");
    } else {
      const diffDays = Math.ceil((dueDate.getTime() - invoiceDate.getTime()) / 86_400_000);
      if (diffDays > input.expectedMaxDueDays) {
        issues.push("Due date range exceeds configured expected maximum.");
      }
    }
  }

  const referenceDate = input.referenceDate;
  if (referenceDate && invoiceDate) {
    const driftDays = Math.abs(Math.ceil((referenceDate.getTime() - invoiceDate.getTime()) / 86_400_000));
    if (driftDays > 365 * 4) {
      issues.push("Invoice date is far outside expected operating window.");
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

function parseIsoDate(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}
