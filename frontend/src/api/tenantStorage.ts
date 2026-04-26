// Shared sessionStorage helpers for the active tenantId. Extracted from
// `auth.ts` so the axios interceptor in `client.ts` can read the tenantId
// without a circular import (`client.ts` -> `auth.ts` -> `client.ts`).
// Mirrors the `useActiveClientOrg` sessionStorage pattern (per-tab; cleared
// on logout).

export const ACTIVE_TENANT_ID_STORAGE_KEY = "activeTenantId";

export function readActiveTenantId(): string | null {
  const value = window.sessionStorage.getItem(ACTIVE_TENANT_ID_STORAGE_KEY);
  return value && value.length > 0 ? value : null;
}

export function writeActiveTenantId(tenantId: string | null): void {
  if (!tenantId) {
    window.sessionStorage.removeItem(ACTIVE_TENANT_ID_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(ACTIVE_TENANT_ID_STORAGE_KEY, tenantId);
}
