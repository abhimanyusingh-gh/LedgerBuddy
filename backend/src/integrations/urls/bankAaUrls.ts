export const BANK_AA_URL_PATHS = {
  consent: "/consent",
  consentRevoke: "/consent/revoke",
  fiFetch: "/fi/fetch",
  aaCallback: "/api/bank/aa-callback"
} as const;

export function aaCallbackUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl}${BANK_AA_URL_PATHS.aaCallback}?sessionId=${encodeURIComponent(sessionId)}`;
}
