import { env } from "@/config/env.js";

const INVITE_URL_PATHS = {
  accept: "/invite"
} as const;

export function inviteAcceptUrl(token: string): string {
  return `${env.INVITE_BASE_URL}${INVITE_URL_PATHS.accept}?token=${encodeURIComponent(token)}`;
}
