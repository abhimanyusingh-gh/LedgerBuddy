export const BANK_ACCOUNT_STATUS = {
  PENDING_CONSENT: "pending_consent",
  ACTIVE: "active",
  PAUSED: "paused",
  REVOKED: "revoked",
  EXPIRED: "expired",
  ERROR: "error",
} as const;

type BankAccountStatus = (typeof BANK_ACCOUNT_STATUS)[keyof typeof BANK_ACCOUNT_STATUS];

export const BankAccountStatuses: BankAccountStatus[] = Object.values(BANK_ACCOUNT_STATUS);
