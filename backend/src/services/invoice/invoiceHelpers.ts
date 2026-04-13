import type { GstBreakdown, InvoiceLineItem, ParsedInvoiceData } from "../../types/invoice.js";

export class InvoiceUpdateError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400
  ) {
    super(message);
    this.name = "InvoiceUpdateError";
  }
}

export function applyNullableField<K extends keyof ParsedInvoiceData>(parsed: ParsedInvoiceData, key: K, val: ParsedInvoiceData[K] | null | undefined) {
  if (val === undefined) return;
  if (val === null) delete parsed[key]; else parsed[key] = val;
}

export function normalizeNullable(source: Record<string, unknown>, field: string, type: "string"): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, field)) return undefined;
  const value = source[field];
  if (value === null) return null;
  if (typeof value !== type) throw new InvoiceUpdateError(`${field} must be a string or null.`);
  const trimmed = (value as string).trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function normalizeNullableCurrency(source: Record<string, unknown>): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "currency")) return undefined;
  const value = source.currency;
  if (value === null) return null;
  if (typeof value !== "string") throw new InvoiceUpdateError("currency must be a string or null.");
  const trimmed = value.trim().toUpperCase();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeNullableMinorAmount(source: Record<string, unknown>): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "totalAmountMinor")) return undefined;
  const value = source.totalAmountMinor;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0)
    throw new InvoiceUpdateError("totalAmountMinor must be a positive integer or null.");
  return value;
}

export function normalizeNullableMajorAmount(source: Record<string, unknown>): number | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "totalAmountMajor")) return undefined;
  const value = source.totalAmountMajor;
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
    return value;
  }
  if (typeof value !== "string") throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new InvoiceUpdateError("totalAmountMajor must be a positive number or numeric string.");
  return parsed;
}

export function normalizeNullableNotes(source: Record<string, unknown>): string[] | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(source, "notes")) return undefined;
  const value = source.notes;
  if (value === null) return null;
  if (!Array.isArray(value)) throw new InvoiceUpdateError("notes must be an array of strings or null.");
  return value.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
}

export function sanitizeParsedData(parsed: unknown): ParsedInvoiceData {
  if (!isPlainObject(parsed)) return {};
  const s = parsed as Record<string, unknown>;
  const str = (v: unknown) => typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  const notes = Array.isArray(s.notes) ? s.notes.map((e) => String(e).trim()).filter((e) => e.length > 0) : undefined;
  return {
    invoiceNumber: str(s.invoiceNumber),
    vendorName: str(s.vendorName),
    invoiceDate: str(s.invoiceDate),
    dueDate: str(s.dueDate),
    totalAmountMinor: typeof s.totalAmountMinor === "number" && Number.isInteger(s.totalAmountMinor) ? s.totalAmountMinor : undefined,
    currency: typeof s.currency === "string" && s.currency.trim().toUpperCase().length > 0 ? s.currency.trim().toUpperCase() : undefined,
    notes: notes && notes.length > 0 ? notes : undefined,
    gst: isPlainObject(s.gst) ? (s.gst as GstBreakdown) : undefined,
    pan: str(s.pan),
    bankAccountNumber: str(s.bankAccountNumber),
    bankIfsc: str(s.bankIfsc),
    lineItems: Array.isArray(s.lineItems) ? (s.lineItems as InvoiceLineItem[]) : undefined
  };
}

export function isCompleteParsedData(parsed: ParsedInvoiceData): boolean {
  return Boolean(
    parsed.invoiceNumber && parsed.vendorName && parsed.invoiceDate && parsed.currency &&
    typeof parsed.totalAmountMinor === "number" && Number.isInteger(parsed.totalAmountMinor) && parsed.totalAmountMinor > 0
  );
}

export function sanitizeForApi<T>(value: T): T {
  return (stripNulls(value) ?? {}) as T;
}

export function stripNulls(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(stripNulls).filter((v) => v !== undefined);
  if (!isPlainObject(value)) return value;
  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const sanitized = stripNulls(rawValue);
    if (sanitized !== undefined) output[key] = sanitized;
  }
  return output;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function getParsedField(parsed: ParsedInvoiceData, field: keyof ParsedInvoiceData): ParsedInvoiceData[keyof ParsedInvoiceData] {
  return parsed[field];
}
