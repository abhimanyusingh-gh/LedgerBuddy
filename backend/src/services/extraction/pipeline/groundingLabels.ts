export const FIELD_LABEL_PATTERNS: Record<string, RegExp> = {
  invoiceNumber: /^(invoice\s*(?:number|no\.?|#)|bill\s*(?:number|no\.?|#)|inv\s*(?:no\.?|#))$/i,
  vendorName: /^(vendor|supplier|sold\s*by|company|from)$/i,
  invoiceDate: /^(invoice\s*date|bill\s*date|date|date\s*of\s*issue|issue\s*date)$/i,
  dueDate: /^(due\s*date|payment\s*due|date\s*due)$/i,
  totalAmountMinor: /^(grand\s*total|total|amount\s*due|balance\s*due|net\s*payable)$/i,
  currency: /^(currency)$/i,
  "gst.gstin": /^(gstin|gst\s*(?:no\.?|number|id|in))$/i,
  "gst.subtotalMinor": /^(sub\s*total|subtotal|taxable\s*(?:value|amount))$/i,
  "gst.cgstMinor": /\bcgst(?:\d+)?\b/i,
  "gst.sgstMinor": /\bsgst(?:\d+)?\b/i,
  "gst.igstMinor": /\bigst(?:\d+)?\b/i,
  "gst.cessMinor": /\bcess\b/i,
  "gst.totalTaxMinor": /\b(total\s*tax|tax\s*total|total\s*gst)\b/i
};
