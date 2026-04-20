const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function isValidGstinFormat(value: string | null | undefined): boolean {
  if (!value) return false;
  return GSTIN_PATTERN.test(value.trim().toUpperCase());
}

export function isValidPanFormat(value: string | null | undefined): boolean {
  if (!value) return false;
  return PAN_PATTERN.test(value.trim().toUpperCase());
}

export function extractPanFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin || !isValidGstinFormat(gstin)) return null;
  return gstin.trim().toUpperCase().slice(2, 12);
}

export function doesPanMatchGstin(pan: string | null | undefined, gstin: string | null | undefined): boolean {
  if (!pan || !gstin) return false;
  const gstinPan = extractPanFromGstin(gstin);
  if (!gstinPan) return false;
  return pan.trim().toUpperCase() === gstinPan;
}
