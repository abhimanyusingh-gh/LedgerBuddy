/**
 * 15-character GSTIN format validator. Mirrors the backend regex in
 * `backend/src/constants/indianCompliance.ts` (`GSTIN_FORMAT`). Both halves
 * MUST stay in sync — the BE schema validator rejects on mismatch, so the
 * client copy is purely for inline form feedback.
 */
export const GSTIN_FORMAT = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export function isValidGstinFormat(value: string): boolean {
  return GSTIN_FORMAT.test(value);
}

/**
 * Derive the 2-digit state code prefix from a GSTIN. Returns null if the
 * input is too short to read the prefix or contains non-digits in positions
 * 0–1. Does NOT map the code to a state name — that lookup happens in the
 * backend `gstinStateCodes.ts` table; once exposed via API the FE will call
 * that endpoint to resolve the name.
 */
export function readGstinStatePrefix(value: string): string | null {
  if (value.length < 2) return null;
  const prefix = value.slice(0, 2);
  if (!/^[0-9]{2}$/.test(prefix)) return null;
  return prefix;
}
