export const EMAIL_TRANSPORT_TYPE = {
  IMAP: "imap",
  MAILHOG_OAUTH: "mailhog_oauth",
} as const;

export type EmailTransportType = (typeof EMAIL_TRANSPORT_TYPE)[keyof typeof EMAIL_TRANSPORT_TYPE];

export const EMAIL_AUTH_MODE = {
  PASSWORD: "password",
  OAUTH2: "oauth2",
} as const;

export type EmailAuthMode = (typeof EMAIL_AUTH_MODE)[keyof typeof EMAIL_AUTH_MODE];
