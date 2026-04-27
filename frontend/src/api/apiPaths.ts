/**
 * Per-path URL-shape dispatch for the axios interceptor.
 *
 * The interceptor in `client.ts` calls `classifyApiPath(path)` to decide
 * whether a request needs URL rewriting (to nested or tenant-scoped shape)
 * or should pass through unchanged. Post-#230 the BE no longer mounts any
 * legacy realm-scoped `/api/...` routes, so every realm-scoped path here
 * MUST rewrite to the nested shape — the bare-path mount no longer exists.
 *
 * Two prefix lists, two rewrite shapes, one enum dispatcher:
 *   - `REALM_SCOPED_PREFIXES` → `/tenants/:tenantId/clientOrgs/:clientOrgId/...`
 *     (handlers depend on `req.activeClientOrgId`).
 *   - `TENANT_SCOPED_PREFIXES` → `/tenants/:tenantId/...`
 *     (tenant-wide; no clientOrgId in the path).
 *   - `classifyApiPath(path)` → `PATH_KIND.{REALM_SCOPED|TENANT_SCOPED|NONE}`
 *     reads both arrays plus the invoice-domain triage bypass rules.
 */

export const PATH_KIND = {
  REALM_SCOPED: "realm-scoped",
  TENANT_SCOPED: "tenant-scoped",
  NONE: "none"
} as const;

type PathKind = typeof PATH_KIND[keyof typeof PATH_KIND];

export const REALM_SCOPED_PREFIXES = [
  // Export domain.
  "/exports",
  "/export-config",
  // Ingestion domain — upload endpoints carry a clientOrgId in the path.
  // The ingest-orchestration endpoints (`/jobs/ingest{,/status,/sse,/pause,
  // /email-simulate}`) and the presign endpoint are tenant-wide and live in
  // `TENANT_SCOPED_PREFIXES`.
  "/jobs/upload",
  // Compliance domain — vendors, GL codes, TCS config, realm-scoped
  // compliance config. The unscoped metadata routes (`/compliance/tds-sections`,
  // `/compliance/risk-signals`, `/compliance/tds-rates`) stay on the legacy
  // `/api` mount and are NOT in this list — FE callers in `admin.ts` invoke
  // them via the bare path, bypassing this rewriter.
  "/vendors",
  "/admin/gl-codes",
  "/admin/tcs-config",
  "/admin/compliance-config",
  // Bank domain — bank accounts + bank statements. The tenant-scoped SSE
  // subscriber endpoint /bank-statements/parse/sse uses EventSource directly
  // and bypasses the axios interceptor, so it stays on the legacy `/api`
  // mount and is NOT included here.
  "/bank/accounts",
  "/bank-accounts",
  "/bank-statements",
  // Invoice domain.
  "/invoices",
  "/admin/approval-workflow",
  "/admin/approval-limits",
  // Notification config.
  "/admin/notification-config"
] as const;

/**
 * Tenant-scoped (no clientOrgId required) prefixes that rewrite to the
 * `/api/tenants/:tenantId/...` shape — WITHOUT a `/clientOrgs/:clientOrgId`
 * segment.
 */
export const TENANT_SCOPED_PREFIXES = [
  // Ingestion — tenant-wide orchestration + presign.
  "/jobs/ingest",
  "/uploads/presign",
  // Tenant domain — administrative + integration routes.
  "/admin/users",
  "/admin/mailboxes",
  "/admin/client-orgs",
  "/admin/mailbox-assignments",
  "/admin/integrations",
  // Notification log — tenant-wide and admin-only (no clientOrgId in the path).
  "/admin/notifications/log",
  "/integrations/gmail",
  // Analytics — single overview endpoint. Optional realm scoping flows via
  // `?clientOrgId=` query param; the BE resolves it via
  // `resolveOptionalClientOrgId`, so no realm-scoped mount.
  "/analytics/overview"
] as const;

/**
 * Sub-paths under a realm-scoped prefix that are actually tenant-scoped
 * (PENDING_TRIAGE invoices carry `clientOrgId: null` per the documented
 * composite-key exception #156, exposed via #166 triage endpoints). These
 * rewrite to `/tenants/:tenantId/...` (no `/clientOrgs/:clientOrgId`
 * segment) — the BE mounts them under `tenantRouter` directly.
 */
const TENANT_SCOPED_BYPASS_PREFIXES = [
  "/invoices/triage"
] as const;

/**
 * Suffix-based bypasses for triage mutations under realm-scoped trees:
 * `/invoices/:id/assign-client-org` and `/invoices/:id/reject`. The check
 * is suffix + must-also-sit-under a realm-scoped prefix (mirrors the
 * legacy classifier's bypass shape so naming stays consistent).
 *
 * WARNING: any new realm-scoped route ending with one of these suffixes
 * (e.g. `/invoices/:id/some-feature/reject`) will silently inherit the
 * tenant-scoped bypass. Add a counter-rule before adding such a route.
 *
 * COUNTER-RULE: any path that ends in `/reject` or `/assign-client-org` but
 * should REMAIN realm-scoped (i.e. needs the nested
 * `/clientOrgs/:clientOrgId` segment in the rewritten URL) must NOT use
 * these suffix names. Rename the new endpoint (e.g. `/workflow-reject`,
 * `/reassign-client-org`), OR explicitly path-handle it BEFORE the suffix
 * check fires in `classifyApiPath`.
 */
const TENANT_SCOPED_BYPASS_SUFFIXES = [
  "/assign-client-org",
  "/reject"
] as const;

function stripQueryString(path: string): string {
  const idx = path.indexOf("?");
  return idx === -1 ? path : path.slice(0, idx);
}

function matchesPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}

function endsWithSuffix(path: string, suffix: string): boolean {
  const bare = stripQueryString(path);
  return bare.endsWith(suffix);
}

function matchesAnyRealmScopedPrefix(path: string): boolean {
  for (const prefix of REALM_SCOPED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  return false;
}

function matchesAnyTenantScopedPrefix(path: string): boolean {
  for (const prefix of TENANT_SCOPED_PREFIXES) {
    if (matchesPrefix(path, prefix)) return true;
  }
  return false;
}

export function classifyApiPath(path: string): PathKind {
  // Tenant-scoped bypass (prefix) wins over realm-scoped — a path may match
  // BOTH `/invoices` (realm) and `/invoices/triage` (tenant bypass). The
  // bypass is the more specific rule.
  for (const bypass of TENANT_SCOPED_BYPASS_PREFIXES) {
    if (matchesPrefix(path, bypass)) return PATH_KIND.TENANT_SCOPED;
  }
  // Tenant-scoped bypass (suffix) — only fires when the path also sits under
  // a realm-scoped prefix, so unrelated `/foo/reject` paths stay
  // unclassified by this helper.
  if (matchesAnyRealmScopedPrefix(path)) {
    for (const suffix of TENANT_SCOPED_BYPASS_SUFFIXES) {
      if (endsWithSuffix(path, suffix)) return PATH_KIND.TENANT_SCOPED;
    }
  }
  // Tenant-scoped data prefixes (ingestion orchestration, tenant-domain admin,
  // integrations) — checked BEFORE realm-scoped so e.g. `/admin/users` (tenant)
  // doesn't get caught by a future `/admin/...` realm prefix.
  if (matchesAnyTenantScopedPrefix(path)) return PATH_KIND.TENANT_SCOPED;
  if (matchesAnyRealmScopedPrefix(path)) return PATH_KIND.REALM_SCOPED;
  return PATH_KIND.NONE;
}

export function isRealmScopedPath(path: string): boolean {
  return classifyApiPath(path) === PATH_KIND.REALM_SCOPED;
}

export function isTenantScopedPath(path: string): boolean {
  return classifyApiPath(path) === PATH_KIND.TENANT_SCOPED;
}

export function rewriteToNestedShape(path: string, tenantId: string, clientOrgId: string): string {
  return `/tenants/${tenantId}/clientOrgs/${clientOrgId}${path.startsWith("/") ? path : `/${path}`}`;
}

export function rewriteToTenantShape(path: string, tenantId: string): string {
  return `/tenants/${tenantId}${path.startsWith("/") ? path : `/${path}`}`;
}
