const ADDRESS_RE = /\b(address|warehouse|village|road|street|taluk|district|postal|zip)\b/i;
const WEAK_VENDOR_RE =
  /\b(currency|invoice|total|amount|date|due|tax|gst|vat|number|booking|booking id|customer|bill to|ship to|company legal name|company trade name|trade name|legal name|hsn\/sac|beneficiary|bank account|ifsc|swift|micr)\b/i;
const COUNTRY_LINE_RE = /\b(united states|united kingdom|india|singapore|australia|canada|germany|france)\b/i;

export function looksLikeAddress(value: string): boolean {
  return ADDRESS_RE.test(value);
}

export function isWeakVendorValue(value: string): boolean {
  return looksLikeAddress(value) || WEAK_VENDOR_RE.test(value) || COUNTRY_LINE_RE.test(value);
}
