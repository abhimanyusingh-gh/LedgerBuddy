import type {
  InvoiceFieldKey,
  InvoiceFieldProvenance,
  ParsedInvoiceData
} from "@/types/invoice.js";

const LLAMA_EXTRACT_FIELD_KEY = {
  INVOICE_NUMBER: "invoice_number",
  VENDOR_NAME: "vendor_name",
  VENDOR_ADDRESS: "vendor_address",
  INVOICE_DATE: "invoice_date",
  DUE_DATE: "due_date",
  CURRENCY: "currency",
  TOTAL_AMOUNT: "total_amount",
  VENDOR_PAN: "vendor_pan",
  SUBTOTAL: "subtotal",
  CGST_AMOUNT: "cgst_amount",
  SGST_AMOUNT: "sgst_amount",
  IGST_AMOUNT: "igst_amount",
  CESS_AMOUNT: "cess_amount",
  VENDOR_GSTIN: "vendor_gstin",
  CUSTOMER_NAME: "customer_name",
  CUSTOMER_ADDRESS: "customer_address",
  CUSTOMER_GSTIN: "customer_gstin",
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

  const vendorAddress = getString(LLAMA_EXTRACT_FIELD_KEY.VENDOR_ADDRESS);
  if (vendorAddress) parsed.vendorAddress = vendorAddress;

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

  const vendorPan = getString(LLAMA_EXTRACT_FIELD_KEY.VENDOR_PAN);
  if (vendorPan) {
    parsed.vendorPan = vendorPan;
    parsed.pan = vendorPan;
  }

  const customerName = getString(LLAMA_EXTRACT_FIELD_KEY.CUSTOMER_NAME);
  if (customerName) parsed.customerName = customerName;

  const customerAddress = getString(LLAMA_EXTRACT_FIELD_KEY.CUSTOMER_ADDRESS);
  if (customerAddress) parsed.customerAddress = customerAddress;

  const customerGstin = getString(LLAMA_EXTRACT_FIELD_KEY.CUSTOMER_GSTIN);
  if (customerGstin) parsed.customerGstin = customerGstin;

  const subtotalRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.SUBTOTAL);
  const cgstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.CGST_AMOUNT);
  const sgstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.SGST_AMOUNT);
  const igstRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.IGST_AMOUNT);
  const cessRaw = getNumber(LLAMA_EXTRACT_FIELD_KEY.CESS_AMOUNT);
  const vendorGstin = getString(LLAMA_EXTRACT_FIELD_KEY.VENDOR_GSTIN);

  const totalTaxRaw = (cgstRaw ?? 0) + (sgstRaw ?? 0) + (igstRaw ?? 0) + (cessRaw ?? 0);
  const hasGst =
    subtotalRaw !== undefined ||
    cgstRaw !== undefined ||
    sgstRaw !== undefined ||
    igstRaw !== undefined ||
    cessRaw !== undefined ||
    vendorGstin !== undefined;

  if (hasGst) {
    const gst: NonNullable<ParsedInvoiceData["gst"]> = {};
    if (subtotalRaw !== undefined) gst.subtotalMinor = Math.round(subtotalRaw * 100);
    if (cgstRaw !== undefined) gst.cgstMinor = Math.round(cgstRaw * 100);
    if (sgstRaw !== undefined) gst.sgstMinor = Math.round(sgstRaw * 100);
    if (igstRaw !== undefined) gst.igstMinor = Math.round(igstRaw * 100);
    if (cessRaw !== undefined) gst.cessMinor = Math.round(cessRaw * 100);
    if (totalTaxRaw > 0) gst.totalTaxMinor = Math.round(totalTaxRaw * 100);
    if (vendorGstin !== undefined) {
      gst.gstin = vendorGstin;
      parsed.vendorGstin = vendorGstin;
    }
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

const EXTRACT_KEY_TO_INVOICE_FIELD: Record<string, InvoiceFieldKey> = {
  invoice_number: "invoiceNumber",
  vendor_name: "vendorName",
  vendor_address: "vendorAddress",
  invoice_date: "invoiceDate",
  due_date: "dueDate",
  total_amount: "totalAmountMinor",
  customer_name: "customerName",
  customer_address: "customerAddress",
  customer_gstin: "customerGstin",
  vendor_gstin: "vendorGstin",
  vendor_pan: "vendorPan"
};

export function buildFieldProvenanceFromExtract(
  raw: unknown
): Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const provenance = raw as Record<string, { page?: number; bboxNormalized?: [number, number, number, number]; confidence?: number; parsingConfidence?: number; extractionConfidence?: number }>;
  const result: Partial<Record<InvoiceFieldKey, InvoiceFieldProvenance>> = {};
  for (const [extractKey, meta] of Object.entries(provenance)) {
    const invoiceKey = EXTRACT_KEY_TO_INVOICE_FIELD[extractKey];
    if (!invoiceKey) continue;
    if (meta.page === undefined && meta.bboxNormalized === undefined && meta.confidence === undefined && meta.parsingConfidence === undefined && meta.extractionConfidence === undefined) continue;
    result[invoiceKey] = {
      ...(meta.page !== undefined ? { page: meta.page } : {}),
      ...(meta.bboxNormalized !== undefined ? { bboxNormalized: meta.bboxNormalized } : {}),
      ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}),
      ...(meta.parsingConfidence !== undefined ? { parsingConfidence: meta.parsingConfidence } : {}),
      ...(meta.extractionConfidence !== undefined ? { extractionConfidence: meta.extractionConfidence } : {})
    };
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
