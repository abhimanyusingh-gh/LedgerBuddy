import type { ParsedInvoiceData } from "@/types/invoice.js";

const LLAMA_EXTRACT_FIELD_KEY = {
  INVOICE_NUMBER: "invoice_number",
  VENDOR_NAME: "vendor_name",
  INVOICE_DATE: "invoice_date",
  DUE_DATE: "due_date",
  CURRENCY: "currency",
  TOTAL_AMOUNT: "total_amount",
  PAN: "pan",
  SUBTOTAL: "subtotal",
  CGST_AMOUNT: "cgst_amount",
  SGST_AMOUNT: "sgst_amount",
  IGST_AMOUNT: "igst_amount",
  CESS_AMOUNT: "cess_amount",
  GSTIN: "gstin",
  LINE_ITEMS: "line_items",
} as const;

type LlamaExtractFieldKey = (typeof LLAMA_EXTRACT_FIELD_KEY)[keyof typeof LLAMA_EXTRACT_FIELD_KEY];

export function parseLlamaExtractFields(fields: Record<string, unknown>): ParsedInvoiceData {
  const parsed: ParsedInvoiceData = {};

  const getString = (key: LlamaExtractFieldKey): string | undefined => {
    const val = fields[key];
    if (typeof val !== "string" || val.trim() === "") return undefined;
    return val.trim();
  };

  const getNumber = (key: LlamaExtractFieldKey): number | undefined => {
    const val = fields[key];
    if (typeof val !== "number" || val === null) return undefined;
    return val;
  };

  const invoiceNumber = getString(LLAMA_EXTRACT_FIELD_KEY.INVOICE_NUMBER);
  if (invoiceNumber) parsed.invoiceNumber = invoiceNumber;

  const vendorName = getString(LLAMA_EXTRACT_FIELD_KEY.VENDOR_NAME);
  if (vendorName) parsed.vendorName = vendorName;

  const invoiceDateStr = getString(LLAMA_EXTRACT_FIELD_KEY.INVOICE_DATE);
  if (invoiceDateStr) {
    const d = new Date(invoiceDateStr);
    if (!isNaN(d.getTime())) parsed.invoiceDate = d;
  }

  const dueDateStr = getString(LLAMA_EXTRACT_FIELD_KEY.DUE_DATE);
  if (dueDateStr) {
    const d = new Date(dueDateStr);
    if (!isNaN(d.getTime())) parsed.dueDate = d;
  }

  const currency = getString(LLAMA_EXTRACT_FIELD_KEY.CURRENCY);
  if (currency) parsed.currency = currency;

  const totalAmountRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.TOTAL_AMOUNT);
  if (totalAmountRaw !== undefined) parsed.totalAmountMinor = Math.round(totalAmountRaw * 100);

  const pan = getString(LLAMA_EXTRACT_FIELD_KEY.PAN);
  if (pan) parsed.pan = pan;

  const subtotalRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.SUBTOTAL);
  const cgstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.CGST_AMOUNT);
  const sgstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.SGST_AMOUNT);
  const igstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.IGST_AMOUNT);
  const cessRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.CESS_AMOUNT);
  const gstin = getString(LLAMA_EXTRACT_FIELD_KEY.GSTIN);

  const totalTaxRaw = (cgstRaw ?? 0) + (sgstRaw ?? 0) + (igstRaw ?? 0) + (cessRaw ?? 0);
  const hasGst =
    subtotalRaw !== undefined ||
    cgstRaw !== undefined ||
    sgstRaw !== undefined ||
    igstRaw !== undefined ||
    cessRaw !== undefined ||
    gstin !== undefined;

  if (hasGst) {
    const gst: NonNullable<ParsedInvoiceData["gst"]> = {};
    if (subtotalRaw !== undefined) gst.subtotalMinor = Math.round(subtotalRaw * 100);
    if (cgstRaw !== undefined) gst.cgstMinor = Math.round(cgstRaw * 100);
    if (sgstRaw !== undefined) gst.sgstMinor = Math.round(sgstRaw * 100);
    if (igstRaw !== undefined) gst.igstMinor = Math.round(igstRaw * 100);
    if (cessRaw !== undefined) gst.cessMinor = Math.round(cessRaw * 100);
    if (totalTaxRaw > 0) gst.totalTaxMinor = Math.round(totalTaxRaw * 100);
    if (gstin !== undefined) gst.gstin = gstin;
    parsed.gst = gst;
  }

  const lineItemsRaw = fields[LLAMA_EXTRACT_FIELD_KEY.LINE_ITEMS];
  if (Array.isArray(lineItemsRaw)) {
    const lineItems = lineItemsRaw
      .map((item: unknown) => {
        if (typeof item !== "object" || item === null) return undefined;
        const obj = item as Record<string, unknown>;
        const description = typeof obj["description"] === "string" ? obj["description"].trim() : "";
        const amountRaw = typeof obj["amount"] === "number" ? obj["amount"] : undefined;
        if (amountRaw === undefined || amountRaw <= 0) return undefined;
        const amountMinor = Math.round(amountRaw * 100);
        const hsnSac = typeof obj["hsn_sac"] === "string" && obj["hsn_sac"].trim() ? obj["hsn_sac"].trim() : undefined;
        const quantity = typeof obj["quantity"] === "number" ? obj["quantity"] : undefined;
        const rate = typeof obj["rate"] === "number" ? obj["rate"] : undefined;
        const taxRate = typeof obj["tax_rate"] === "number" ? obj["tax_rate"] : undefined;
        const cgstMinor = typeof obj["cgst"] === "number" ? Math.round(obj["cgst"] * 100) : undefined;
        const sgstMinor = typeof obj["sgst"] === "number" ? Math.round(obj["sgst"] * 100) : undefined;
        const igstMinor = typeof obj["igst"] === "number" ? Math.round(obj["igst"] * 100) : undefined;
        return {
          description,
          amountMinor,
          ...(hsnSac !== undefined ? { hsnSac } : {}),
          ...(quantity !== undefined ? { quantity } : {}),
          ...(rate !== undefined ? { rate } : {}),
          ...(taxRate !== undefined ? { taxRate } : {}),
          ...(cgstMinor !== undefined ? { cgstMinor } : {}),
          ...(sgstMinor !== undefined ? { sgstMinor } : {}),
          ...(igstMinor !== undefined ? { igstMinor } : {}),
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (lineItems.length > 0) {
      parsed.lineItems = lineItems;
    }
  }

  return parsed;
}
