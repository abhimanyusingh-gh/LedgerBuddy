export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_FORMAT.test(value);
}

export function readGstinStatePrefix(value: string): string | null {
  if (value.length < 2) return null;
  const prefix = value.slice(0, 2);
  if (!/^[0-9]{2}$/.test(prefix)) return null;
  return prefix;
}
