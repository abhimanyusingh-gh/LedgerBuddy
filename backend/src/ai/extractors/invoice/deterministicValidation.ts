import type { ParsedInvoiceData } from "@/types/invoice.js";

const ADDRESS_SIGNAL_PATTERN =
  /\b(address|warehouse|village|road|street|avenue|taluk|district|state|country|postal|pin|zipcode)\b/i;

const PAN_FORMAT_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_FORMAT_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

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

  const gst = parsed.gst;
  if (gst && gst.subtotalMinor && gst.subtotalMinor > 0) {
    const totalTax = (gst.cgstMinor ?? 0) + (gst.sgstMinor ?? 0) + (gst.igstMinor ?? 0);
    if (totalTax > 0) {
      const expectedTotal = gst.subtotalMinor + totalTax + (gst.cessMinor ?? 0);
      const actualTotal = parsed.totalAmountMinor ?? 0;
      if (actualTotal > 0 && Math.abs(expectedTotal - actualTotal) > 100) {
        issues.push(`GST_TOTAL_MISMATCH: Subtotal (${gst.subtotalMinor}) + taxes (${totalTax}) = ${expectedTotal}, but total is ${actualTotal}.`);
      }
    }
  }

  if (parsed.lineItems && parsed.lineItems.length > 0) {
    const lineItemTotal = parsed.lineItems.reduce((sum, item) => sum + item.amountMinor, 0);
    const subtotal = parsed.gst?.subtotalMinor ?? parsed.totalAmountMinor;
    if (subtotal && Math.abs(lineItemTotal - subtotal) > 100) {
      issues.push(`LINE_ITEM_TOTAL_MISMATCH: Line item sum (${lineItemTotal}) differs from subtotal (${subtotal}) by more than ₹1.`);
    }
  }

  const pan = parsed.pan;
  if (pan && !PAN_FORMAT_PATTERN.test(pan)) {
    issues.push("PAN_FORMAT_INVALID: Extracted PAN does not match expected format.");
  }

  const gstin = parsed.gst?.gstin;
  if (gstin && !GSTIN_FORMAT_PATTERN.test(gstin)) {
    issues.push("GSTIN_FORMAT_INVALID: Extracted GSTIN does not match expected 15-character format.");
  }

  if (pan && gstin && PAN_FORMAT_PATTERN.test(pan) && GSTIN_FORMAT_PATTERN.test(gstin)) {
    const panFromGstin = gstin.substring(2, 12);
    if (panFromGstin !== pan) {
      issues.push("PAN_GSTIN_MISMATCH: PAN does not match characters 3-12 of GSTIN.");
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
    .flatMap((line) => Array.from(line.matchAll(/[-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)(?:[.,]\d{1,3})?/g), (match) => match[0]))
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
    const match = line.match(/[-+]?(?:\d{1,3}(?:[,\s.]\d{2,3})+|\d+)([.,]\d{3,})\b/);
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
    const commaParts = normalized.split(",");
    const isIndian = commaParts.length >= 3 && commaParts[commaParts.length - 1].length === 3 &&
      commaParts.slice(1, -1).every((segment) => segment.length === 2);
    if (isIndian) {
      normalized = commaParts.join("");
    } else {
      const fractionalDigits = commaParts.at(-1)?.length ?? 0;
      normalized = fractionalDigits <= 2 ? normalized.replace(",", ".") : normalized.replace(/,/g, "");
    }
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
