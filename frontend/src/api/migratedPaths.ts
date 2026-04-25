/**
 * Pure helpers for the #171 nested-router URL migration. Extracted from
 * `client.ts` so they can be unit-tested standalone — `client.ts` pulls in
 * `import.meta.env` which Jest's CJS runtime can't parse (same workaround
 * pattern as `classifyApiPath.ts`).
 *
 * Each domain that migrates to the new `/api/tenants/:tenantId/clientOrgs/
 * :clientOrgId/...` path shape adds its top-level prefixes here. The axios
 * interceptor consults this list BEFORE the legacy `?clientOrgId=` query
 * injection so migrated paths take the new shape.
 */

export const MIGRATED_REALM_SCOPED_PREFIXES = [
  // Export domain (#199, sub-PR 1) — first vertical slice migrated.
  "/exports",
  "/export-config"
] as const;

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

export function isMigratedRealmScopedPath(path: string): boolean {
  for (const prefix of MIGRATED_REALM_SCOPED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  return false;
}

export function rewriteToNestedShape(path: string, tenantId: string, clientOrgId: string): string {
  return `/tenants/${tenantId}/clientOrgs/${clientOrgId}${path.startsWith("/") ? path : `/${path}`}`;
}
