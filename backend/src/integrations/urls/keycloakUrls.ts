export const KEYCLOAK_URL_PATHS = {
  adminUsers: (realm: string): string => `/admin/realms/${realm}/users`,
  adminUserById: (realm: string, kcUserId: string): string => `/admin/realms/${realm}/users/${kcUserId}`,
  adminUserResetPassword: (realm: string, kcUserId: string): string =>
    `/admin/realms/${realm}/users/${kcUserId}/reset-password`,
  adminUserExecuteActionsEmail: (realm: string, kcUserId: string): string =>
    `/admin/realms/${realm}/users/${kcUserId}/execute-actions-email`,
  openIdConnectToken: (realm: string): string => `/realms/${realm}/protocol/openid-connect/token`
} as const;
