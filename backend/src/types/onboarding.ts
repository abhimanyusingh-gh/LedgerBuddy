export const ONBOARDING_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
} as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUS)[keyof typeof ONBOARDING_STATUS];

export const TENANT_MODE = {
  TEST: "test",
  LIVE: "live",
} as const;

export type TenantMode = (typeof TENANT_MODE)[keyof typeof TENANT_MODE];
