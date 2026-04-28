// BE-side URL provider mirror. Path constants used by Express route
// registration come from here, NOT inline string literals at the
// registration site. The contract walker resolves these property
// accesses to their literal values (see `extractRoutesFromNode` in
// check-fe-be-contract.ts) so registration-site drift is caught.
export const TENANT_URL_PATHS = {
  onboardingCompleteNested: "/onboarding/complete",
  inviteAccept: "/tenant/invites/accept"
} as const;
