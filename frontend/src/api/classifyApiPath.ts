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
  "/invoices",
  "/vendors",
  "/payments",
  // `/exports` migrated to nested-router shape (#171 sub-PR 1) — handled by
  // `MIGRATED_REALM_SCOPED_PREFIXES` in `client.ts`. Remaining domains stay
  // here until their respective sub-PRs ship.
  "/bank-statements",
  "/bank-accounts",
  "/bank/accounts",
  "/compliance",
  // Composite-key endpoints that live under otherwise-tenant-scoped trees.
  // Listed before the broader `/admin` and `/tenant` tenant-scoped prefixes
  // so the realm-scoped check fires first.
  "/admin/notification-config",
  "/admin/compliance-config",
  "/admin/tcs-config",
  "/admin/gl-codes",
  "/admin/approval-limits",
  "/admin/approval-workflow"
] as const;

const REALM_SCOPED_PATH_BYPASS_PREFIXES = [
  "/compliance/admin",
  // Triage list (#166): the ONE accounting-leaf list query that legitimately
  // filters by tenantId WITHOUT clientOrgId — these invoices have
  // clientOrgId: null because mailbox routing couldn't decide their realm.
  // Documented exception per #156.
  "/invoices/triage"
] as const;

// Triage mutations (#166): assign-client-org / reject sit under /invoices/:id/
// but operate on invoices with clientOrgId: null. They MUST NOT have
// `?clientOrgId=` injected by the interceptor (operator may have no active
// realm picked while triaging). Suffix-based bypass keeps the existing
// prefix matcher untouched for everything else.
//
// WARNING: any new sub-path ending with one of these suffixes UNDER a
// realm-scoped prefix (e.g. `/invoices/:id/some-feature/reject`) will
// silently inherit the bypass and skip clientOrgId injection. Do NOT reuse
// these suffixes for non-bypass routes. If a new route legitimately needs
// to end with `/reject` or `/assign-client-org` AND must remain realm-scoped,
// add a counter-rule here before adding the route.
const REALM_SCOPED_PATH_BYPASS_SUFFIXES = [
  "/assign-client-org",
  "/reject"
] as const;

const TENANT_SCOPED_PATH_PREFIXES = [
  "/admin",
  "/auth",
  "/integrations",
  "/jobs",
  "/uploads",
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

function matchesSuffixUnderRealmScoped(path: string, suffix: string): boolean {
  if (!path.endsWith(suffix)) return false;
  const head = path.slice(0, path.length - suffix.length);
  for (const prefix of REALM_SCOPED_PATH_PREFIXES) {
    if (matchesPrefix(head, prefix)) return true;
  }
  return false;
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
  for (const suffix of REALM_SCOPED_PATH_BYPASS_SUFFIXES) {
    if (matchesSuffixUnderRealmScoped(normalized, suffix)) return "tenant-scoped";
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
