const INVITE_URL_PATHS = {
  accept: "/invite"
} as const;

export function inviteAcceptUrl(baseUrl: string, token: string): string {
  return `${baseUrl}${INVITE_URL_PATHS.accept}?token=${encodeURIComponent(token)}`;
}
