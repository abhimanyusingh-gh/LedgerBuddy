import type { ParsedInvoiceData } from "../../types/invoice.js";

const ADDRESS_SIGNAL_PATTERN =
  /\b(address|warehouse|village|road|street|avenue|taluk|district|state|country|postal|pin|zipcode)\b/i;

interface DeterministicValidationInput {
  parsed: ParsedInvoiceData;
  ocrText?: string;
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

  const totalAmountMinor = parsed.totalAmountMinor;
  if (typeof totalAmountMinor !== "number" || !Number.isInteger(totalAmountMinor) || totalAmountMinor <= 0) {
    issues.push("Total amount is missing or invalid.");
  } else {
    const hardMax = Math.round(Math.max(1, input.expectedMaxTotal) * 100);
    if (totalAmountMinor > hardMax) {
      issues.push("Total amount exceeds configured expected maximum.");
    }

    const vatAmountMinor = extractTaxAmountMinor(input.ocrText);
    if (vatAmountMinor !== undefined && vatAmountMinor > totalAmountMinor) {
      issues.push("Detected VAT/tax value exceeds invoice total.");
    }

    if (detectInvalidTotalPrecision(input.ocrText)) {
      issues.push("Detected total amount with unsupported decimal precision.");
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

function extractTaxAmountMinor(text?: string): number | undefined {
  if (!text || text.trim().length === 0) {
    return undefined;
  }

  const taxLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /\b(vat|gst|mwst|ust|tax)\b/i.test(line));

  const amounts = taxLines
    .flatMap((line) => [...line.matchAll(/[-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)(?:[.,]\d{1,3})?/g)].map((match) => match[0]))
    .map((raw) => parseAmountMinor(raw))
    .filter((value): value is number => value !== undefined && value > 0);

  if (amounts.length === 0) {
    return undefined;
  }

  return Math.max(...amounts);
}

function detectInvalidTotalPrecision(text?: string): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }

  const totalLines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => /\b(grand\s*total|invoice\s*total|amount\s*due|balance\s*due|total\s*due|amount\s*payable)\b/i.test(line));

  return totalLines.some((line) => {
    const match = line.match(/[-+]?(?:\d{1,3}(?:[,\s.]\d{3})+|\d+)([.,]\d{3,})\b/);
    return Boolean(match);
  });
}

function parseAmountMinor(raw: string): number | undefined {
  const sanitized = raw.replace(/\s+/g, "");
  if (!sanitized) {
    return undefined;
  }

  let normalized = sanitized.replace(/[^0-9,.\-+]/g, "");
  if (!normalized) {
    return undefined;
  }

  const negative = normalized.startsWith("-");
  normalized = normalized.replace(/^[+-]/, "");

  if (normalized.includes(",") && normalized.includes(".")) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (normalized.includes(",")) {
    const fractionalDigits = normalized.split(",").at(-1)?.length ?? 0;
    normalized = fractionalDigits <= 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  const minor = Math.round(parsed * 100);
  return negative ? -minor : minor;
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
