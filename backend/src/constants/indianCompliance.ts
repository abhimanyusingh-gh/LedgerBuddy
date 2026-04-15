export const PAN_FORMAT = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export const UDYAM_FORMAT = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

export const IRN_FORMAT = /^[a-f0-9]{64}$/i;

export const ADDRESS_SIGNAL_PATTERN =
  /\b(address|warehouse|village|road|street|st\.|avenue|ave\.|taluk|district|state|country|india|karnataka|hobli|zip|zipcode|postal|pin|near)\b/i;

export const E_INVOICE_THRESHOLD_MINOR = 500_000_000;

export const VALID_PAN_CATEGORIES = new Set(["C", "P", "H", "F", "T", "A", "B", "L", "J", "G"]);

export function extractPanFromGstin(gstin: string): string {
  return gstin.substring(2, 12);
}

export function derivePanCategory(pan: string): string | null {
  if (pan.length < 4) return null;
  const code = pan.charAt(3).toUpperCase();
  return VALID_PAN_CATEGORIES.has(code) ? code : null;
}
