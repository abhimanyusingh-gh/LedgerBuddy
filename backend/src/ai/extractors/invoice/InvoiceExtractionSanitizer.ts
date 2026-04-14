import type { ParsedInvoiceData } from "@/types/invoice.js";
import { uniqueIssues } from "../stages/fieldParsingUtils.js";

export function sanitizeInvoiceExtraction(parsed: ParsedInvoiceData | undefined): ParsedInvoiceData {
  if (!parsed) {
    return {};
  }

  const normalized: ParsedInvoiceData = {};
  const copyString = (value: unknown): string | undefined => {
    if (typeof value !== "string") {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const invoiceNumber = copyString(parsed.invoiceNumber);
  if (invoiceNumber) {
    normalized.invoiceNumber = invoiceNumber;
  }
  const vendorName = copyString(parsed.vendorName);
  if (vendorName) {
    normalized.vendorName = vendorName;
  }
  const invoiceDate = copyString(parsed.invoiceDate);
  if (invoiceDate) {
    normalized.invoiceDate = invoiceDate;
  }
  const dueDate = copyString(parsed.dueDate);
  if (dueDate) {
    normalized.dueDate = dueDate;
  }
  const currency = copyString(parsed.currency);
  if (currency) {
    normalized.currency = currency.toUpperCase();
  }
  if (Number.isInteger(parsed.totalAmountMinor) && (parsed.totalAmountMinor ?? 0) > 0) {
    normalized.totalAmountMinor = parsed.totalAmountMinor;
  }

  const notes = uniqueIssues(parsed.notes ?? []);
  if (notes.length > 0) {
    normalized.notes = notes;
  }

  const gst = parsed.gst;
  if (gst) {
    const normalizedGst: NonNullable<ParsedInvoiceData["gst"]> = {};
    if (copyString(gst.gstin)) {
      normalizedGst.gstin = gst.gstin?.trim();
    }
    for (const field of [
      "subtotalMinor",
      "cgstMinor",
      "sgstMinor",
      "igstMinor",
      "cessMinor",
      "totalTaxMinor"
    ] as const) {
      const value = gst[field];
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
        normalizedGst[field] = value;
      }
    }
    if (Object.keys(normalizedGst).length > 0) {
      normalized.gst = normalizedGst;
    }
  }

  if (Array.isArray(parsed.lineItems)) {
    const lineItems = parsed.lineItems
      .map((item) => {
        const description = copyString(item.description) ?? "";
        if (!Number.isInteger(item.amountMinor) || item.amountMinor <= 0) {
          return undefined;
        }
        return {
          ...item,
          description
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (lineItems.length > 0) {
      normalized.lineItems = lineItems;
    }
  }

  const pan = copyString(parsed.pan);
  if (pan) {
    normalized.pan = pan.toUpperCase();
  }
  const bankAccountNumber = copyString(parsed.bankAccountNumber);
  if (bankAccountNumber) {
    normalized.bankAccountNumber = bankAccountNumber;
  }
  const bankIfsc = copyString(parsed.bankIfsc);
  if (bankIfsc) {
    normalized.bankIfsc = bankIfsc.toUpperCase();
  }

  return normalized;
}
