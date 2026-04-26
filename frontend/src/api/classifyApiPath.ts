/**
 * API path classifier for the {tenantId, clientOrgId} composite-key access
 * boundary. Pure function — no side effects, no axios/window access — so it
 * can be unit-tested standalone (the rest of `client.ts` pulls in `import.meta`
 * which Jest's CJS runtime can't parse).
 *
 * Hand-maintained: the realm-scoped allow-list mirrors the BE routes wrapped
 * in `requireActiveClientOrg`. CI guard `backend/scripts/check-realm-scoped-paths.sh`
 * diffs this file against BE middleware registrations and fails the build on
 * drift. Long-term replacement (BE-driven code-gen) tracked in #170.
 *
 * Cache-key partitioning is owned by `useScopedQuery` (which reads
 * `activeClientOrgId` directly), NOT by this classifier. Removing entries here
 * as domains migrate to the nested-mount path shape (#171) is safe for
 * realm-scoping cache isolation.
 */

/**
 * @public
 * Consumed by `backend/scripts/check-realm-scoped-paths.sh` via text grep
 * (sed parse between the `[` and `] as const;` markers). Knip cannot see
 * cross-language string-grep consumers, so this `@public` tag tells knip
 * the export is intentional even with no static TS importer outside this
 * file.
 */
export const REALM_SCOPED_PATH_PREFIXES = [
  "/payments",
  // `/exports` migrated to nested-router shape (#171 sub-PR 1) — handled by
  // `MIGRATED_REALM_SCOPED_PREFIXES` in `migratedPaths.ts`.
  // `/vendors`, `/admin/gl-codes`, `/admin/tcs-config`, `/admin/compliance-config`
  // migrated by sub-PR for #200 (compliance domain).
  // `/bank-statements`, `/bank-accounts`, `/bank/accounts` migrated by sub-PR
  // for #201 (bank domain).
  // `/invoices`, `/admin/approval-workflow`, `/admin/approval-limits` migrated
  // to nested-router shape (#171 / #204 — final sub-PR closes #171). Triage
  // bypass entries (`/invoices/triage`, `/assign-client-org`, `/reject`)
  // moved to `migratedPaths.ts` as `MIGRATED_TENANT_SCOPED_BYPASS_*` since
  // the new path shape routes them under `tenantRouter` directly.
  // Composite-key endpoints that live under otherwise-tenant-scoped trees.
  // Listed before the broader `/admin` and `/tenant` tenant-scoped prefixes
  // so the realm-scoped check fires first.
  "/admin/notification-config"
] as const;

const REALM_SCOPED_PATH_BYPASS_PREFIXES = [
  "/compliance/admin"
] as const;

const TENANT_SCOPED_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/integrations",
  // `/jobs` and `/uploads` migrated to nested-router shape (#198, sub-PR 2).
  // The ingest-orchestration sub-tree (`/jobs/ingest`) and `/uploads/presign`
  // live in `MIGRATED_TENANT_SCOPED_PREFIXES` in `migratedPaths.ts`; the
  // upload sub-tree (`/jobs/upload`) lives in `MIGRATED_REALM_SCOPED_PREFIXES`.
  "/tenant",
  "/platform",
  "/analytics",
  "/session"
] as const;

type RealmScope = "realm-scoped" | "tenant-scoped" | "unknown";

function stripQueryString(path: string): string {
  const idx = path.indexOf("?");
  return idx === -1 ? path : path.slice(0, idx);
}

/**
 * Exact-prefix match: a prefix matches the path iff the path equals the prefix
 * or extends it with a `/` boundary. Prevents `/compliance/admin` from matching
 * `/compliance/administrators` (the original bypass-vs-allow asymmetry bug).
 */
function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Single source of truth for routing API paths into the {tenantId, clientOrgId}
 * composite-key access boundary. Both the bypass list and the realm-scoped list
 * use the same exact-prefix strategy, so every prefix has a `/` boundary.
 *
 * - `realm-scoped`: needs an active clientOrgId (interceptor injects the param).
 * - `tenant-scoped`: tenant-only, no clientOrgId required.
 * - `unknown`: not in either list — interceptor treats as tenant-only.
 */
export function classifyApiPath(path: string): RealmScope {
  const normalized = stripQueryString(path);
  for (const bypass of REALM_SCOPED_PATH_BYPASS_PREFIXES) {
    if (matchesPrefix(normalized, bypass)) return "tenant-scoped";
  }
  for (const prefix of REALM_SCOPED_PATH_PREFIXES) {
    if (matchesPrefix(normalized, prefix)) return "realm-scoped";
  }
  for (const prefix of TENANT_SCOPED_PATH_PREFIXES) {
    if (matchesPrefix(normalized, prefix)) return "tenant-scoped";
  }
  return "unknown";
}

export function isRealmScopedPath(path: string): boolean {
  return classifyApiPath(path) === "realm-scoped";
}
