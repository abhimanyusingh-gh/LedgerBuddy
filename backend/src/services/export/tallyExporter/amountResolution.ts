import { extractTotalAmount } from "@/ai/parsers/invoiceParser.js";
import { isPositiveMinorUnits, normalizeMinorUnits, toMinorUnits } from "@/utils/currency.js";

export function resolveInvoiceTotalAmountMinor(
  parsedTotalAmountMinor?: number | null,
  currency?: string | null,
  ocrText?: string | null
): number | null {
  const normalizedParsedMinor = normalizeMinorUnits(parsedTotalAmountMinor);
  if (isPositiveMinorUnits(normalizedParsedMinor)) {
    return normalizedParsedMinor;
  }

  if (!ocrText || ocrText.trim().length === 0) {
    return null;
  }

  const ocrDerived = extractTotalAmount(ocrText);
  if (!isPositiveAmount(ocrDerived)) {
    return null;
  }

  return toMinorUnits(ocrDerived, currency);
}

function isPositiveAmount(value?: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}
