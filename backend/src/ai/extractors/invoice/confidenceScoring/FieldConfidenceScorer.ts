import type { ParsedInvoiceData } from "@/types/invoice.js";

const ADDRESS_RE = /\b(address|warehouse|village|road|street|taluk|district|postal|zip)\b/i;

function looksLikeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

const VALIDATION_KEY_BY_FIELD: Record<string, string> = {
  totalAmountMinor: "total amount",
  vendorName: "vendor",
  invoiceNumber: "invoice number",
  currency: "currency",
  dueDate: "due date",
  invoiceDate: "invoice date"
};

function inferHeuristicConfidence(field: keyof ParsedInvoiceData, value: unknown, warningText: string): number {
  if (field === "totalAmountMinor") {
    if (typeof value !== "number" || value <= 0) {
      return 0.45;
    }
    return warningText.includes("total amount") ? 0.7 : 0.92;
  }
  if (field === "vendorName") {
    if (typeof value !== "string") {
      return 0.45;
    }
    if (looksLikeAddress(value)) {
      return 0.5;
    }
    return warningText.includes("vendor name") ? 0.68 : 0.9;
  }
  if (field === "invoiceNumber") {
    return warningText.includes("invoice number") ? 0.65 : 0.9;
  }
  if (field === "currency") {
    return warningText.includes("currency") ? 0.7 : 0.88;
  }
  return 0.82;
}

function inferValidationBonus(field: keyof ParsedInvoiceData, validationText: string): number {
  const key = VALIDATION_KEY_BY_FIELD[field] ?? field;
  return validationText.includes(key) ? 0.7 : 1;
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
}

export function scoreFieldConfidence(
  field: keyof ParsedInvoiceData,
  value: unknown,
  warningText: string,
  validationText: string,
  ocrConfidence: number
): number {
  const heuristicConfidence = inferHeuristicConfidence(field, value, warningText);
  const validationBonus = inferValidationBonus(field, validationText);
  return clampProbability(ocrConfidence * heuristicConfidence * validationBonus);
}
