/**
 * Pure helpers for the #171 nested-router URL migration. Extracted from
 * `client.ts` so they can be unit-tested standalone — `client.ts` pulls in
 * `import.meta.env` which Jest's CJS runtime can't parse (same workaround
 * pattern as `classifyApiPath.ts`).
 *
 * Two prefix lists, two rewrite shapes:
 *   - `MIGRATED_REALM_SCOPED_PREFIXES` → `/tenants/:tenantId/clientOrgs/:clientOrgId/...`
 *     (handlers depend on `req.activeClientOrgId`).
 *   - `MIGRATED_TENANT_SCOPED_PREFIXES` → `/tenants/:tenantId/...`
 *     (tenant-wide; no clientOrgId in the path).
 *
 * The axios interceptor in `client.ts` consults these BEFORE the legacy
 * `?clientOrgId=` query injection: migrated paths take the new shape and
 * skip the query param entirely.
 */

export const MIGRATED_REALM_SCOPED_PREFIXES = [
  // Export domain (#199, sub-PR 1) — first vertical slice migrated.
  "/exports",
  "/export-config",
  // Ingestion domain (#198, sub-PR 2): the upload endpoints carry a
  // clientOrgId in the path. The ingest-orchestration endpoints
  // (`/jobs/ingest{,/status,/sse,/pause,/email-simulate}`) and the presign
  // endpoint are tenant-wide and live in `MIGRATED_TENANT_SCOPED_PREFIXES`.
  "/jobs/upload"
] as const;

export const MIGRATED_TENANT_SCOPED_PREFIXES = [
  // Ingestion domain (#198, sub-PR 2) — tenant-wide orchestration + presign.
  "/jobs/ingest",
  "/uploads/presign"
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

export function isMigratedTenantScopedPath(path: string): boolean {
  for (const prefix of MIGRATED_TENANT_SCOPED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  return false;
}

export function rewriteToNestedShape(path: string, tenantId: string, clientOrgId: string): string {
  return `/tenants/${tenantId}/clientOrgs/${clientOrgId}${path.startsWith("/") ? path : `/${path}`}`;
}

export function rewriteToTenantShape(path: string, tenantId: string): string {
  return `/tenants/${tenantId}${path.startsWith("/") ? path : `/${path}`}`;
}
