import type { ParsedInvoiceData } from "@/types/invoice.js";
import { uniqueStrings } from "@/utils/text.js";

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

function normalizeGstin(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length !== 15 || !GSTIN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

function normalizePan(raw: string | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim().toUpperCase();
  if (trimmed.length !== 10 || !PAN_PATTERN.test(trimmed)) return undefined;
  return trimmed;
}

export function normalizeInvoiceFields(parsed: ParsedInvoiceData | undefined): ParsedInvoiceData {
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
  const vendorAddress = copyString(parsed.vendorAddress);
  if (vendorAddress) {
    normalized.vendorAddress = vendorAddress;
  }
  const vendorGstin = normalizeGstin(parsed.vendorGstin);
  if (vendorGstin) {
    normalized.vendorGstin = vendorGstin;
  }
  const vendorPan = normalizePan(parsed.vendorPan);
  if (vendorPan) {
    normalized.vendorPan = vendorPan;
  }
  const customerName = copyString(parsed.customerName);
  if (customerName) {
    normalized.customerName = customerName;
  }
  const customerAddress = copyString(parsed.customerAddress);
  if (customerAddress) {
    normalized.customerAddress = customerAddress;
  }
  const customerGstin = normalizeGstin(parsed.customerGstin);
  if (customerGstin) {
    normalized.customerGstin = customerGstin;
  }
  if (parsed.invoiceDate instanceof Date && !isNaN(parsed.invoiceDate.getTime())) {
    normalized.invoiceDate = parsed.invoiceDate;
  }
  if (parsed.dueDate instanceof Date && !isNaN(parsed.dueDate.getTime())) {
    normalized.dueDate = parsed.dueDate;
  }
  const currency = copyString(parsed.currency);
  if (currency) {
    normalized.currency = currency.toUpperCase();
  }
  if (Number.isInteger(parsed.totalAmountMinor) && (parsed.totalAmountMinor ?? 0) > 0) {
    normalized.totalAmountMinor = parsed.totalAmountMinor;
  }

  const notes = uniqueStrings(parsed.notes ?? []);
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
