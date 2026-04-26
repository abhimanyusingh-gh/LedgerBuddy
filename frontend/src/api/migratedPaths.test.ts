/**
 * Standalone tests for the #171 nested-router migration helpers consumed by
 * the axios request interceptor in `client.ts`. Imported from
 * `migratedPaths.ts` (not `client.ts`) so the tests stay in a pure-node
 * environment — `client.ts` pulls in `import.meta.env` which Jest's CJS
 * runtime can't parse (same workaround pattern as `classifyApiPath.test.ts`).
 *
 * These tests assert three complementary contracts:
 *   1. For migrated REALM-scoped paths (export, ingestion-upload, compliance,
 *      bank, invoice), the helper detects the path AND rewrites it into the
 *      nested `/tenants/:tenantId/clientOrgs/:clientOrgId/...` shape the BE
 *      expects.
 *   2. For migrated TENANT-scoped paths (ingestion orchestration, tenant
 *      domain admin/integrations, plus invoice triage + triage mutations),
 *      the helper rewrites them into `/tenants/:tenantId/...` (no
 *      clientOrgs segment) — these routes are mounted under `tenantRouter`
 *      directly. Triage routes are scoped this way because PENDING_TRIAGE
 *      invoices carry `clientOrgId: null` (#156).
 *   3. For NON-migrated paths (everything else), the helper returns
 *      `MIGRATED_PATH_KIND.NONE` so the interceptor falls through to the
 *      legacy `?clientOrgId=` query injection branch (covered by
 *      classifyApiPath.test.ts).
 */
import {
  MIGRATED_PATH_KIND,
  MIGRATED_REALM_SCOPED_PREFIXES,
  MIGRATED_TENANT_SCOPED_PREFIXES,
  classifyMigratedPath,
  isMigratedRealmScopedPath,
  isMigratedTenantScopedPath,
  rewriteToNestedShape,
  rewriteToTenantShape
} from "@/api/migratedPaths";

describe("api/migratedPaths", () => {
  describe("isMigratedRealmScopedPath — migrated realm-scoped paths", () => {
    const migratedRealm = [
      // Export domain (#199, sub-PR 1).
      "/exports",
      "/exports/tally",
      "/exports/tally/download",
      "/exports/tally/history",
      "/exports/tally/download/batch-123",
      "/exports/csv",
      "/export-config",
      // Ingestion sub-PR 2: realm-scoped uploads.
      "/jobs/upload",
      "/jobs/upload/by-keys",
      // Compliance domain (#200).
      "/vendors",
      "/vendors/v-1",
      "/admin/gl-codes",
      "/admin/gl-codes/SOMECODE",
      "/admin/gl-codes/import-csv",
      "/admin/tcs-config",
      "/admin/tcs-config/roles",
      "/admin/tcs-config/history",
      "/admin/compliance-config",
      // Invoice domain (#204, final vertical slice).
      "/invoices",
      "/invoices/abc-123",
      "/invoices/abc-123/document",
      "/invoices/abc-123/preview",
      "/invoices/abc-123/workflow-approve",
      "/invoices/abc-123/workflow-reject",
      "/invoices/approve",
      "/invoices/retry",
      "/invoices/delete",
      "/invoices/action-required",
      "/admin/approval-workflow",
      "/admin/approval-limits"
    ];

    test.each(migratedRealm)("returns true for %s", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(true);
      expect(classifyMigratedPath(path)).toBe(MIGRATED_PATH_KIND.REALM_SCOPED);
    });

    it("matches a path with a query string suffix", () => {
      expect(isMigratedRealmScopedPath("/exports/tally/history?page=2")).toBe(true);
      expect(isMigratedRealmScopedPath("/export-config?fields=tallyCompanyName")).toBe(true);
      expect(isMigratedRealmScopedPath("/vendors?search=acme")).toBe(true);
      expect(isMigratedRealmScopedPath("/admin/gl-codes?limit=200")).toBe(true);
      expect(isMigratedRealmScopedPath("/invoices?status=pending")).toBe(true);
      expect(isMigratedRealmScopedPath("/invoices/action-required?limit=50")).toBe(true);
    });
  });

  describe("isMigratedTenantScopedPath — migrated paths (ingestion orchestration + presign)", () => {
    const migrated = [
      "/jobs/ingest",
      "/jobs/ingest/status",
      "/jobs/ingest/sse",
      "/jobs/ingest/pause",
      "/jobs/ingest/email-simulate",
      "/uploads/presign"
    ];

    test.each(migrated)("returns true for %s", (path) => {
      expect(isMigratedTenantScopedPath(path)).toBe(true);
      expect(classifyMigratedPath(path)).toBe(MIGRATED_PATH_KIND.TENANT_SCOPED);
    });

    it("does NOT classify realm-scoped upload paths as tenant-scoped", () => {
      expect(isMigratedTenantScopedPath("/jobs/upload")).toBe(false);
      expect(isMigratedTenantScopedPath("/jobs/upload/by-keys")).toBe(false);
    });
  });

  describe("isMigratedRealmScopedPath — migrated paths (bank domain, sub-PR 2)", () => {
    const migrated = [
      "/bank/accounts",
      "/bank/accounts/abc-123",
      "/bank/accounts/abc-123/refresh",
      "/bank-accounts",
      "/bank-statements",
      "/bank-statements/upload",
      "/bank-statements/upload-csv",
      "/bank-statements/vendor-gstins",
      "/bank-statements/account-names",
      "/bank-statements/abc-123/matches",
      "/bank-statements/abc-123/transactions",
      "/bank-statements/abc-123/reconcile",
      "/bank-statements/transactions/txn-1/match"
    ];

    test.each(migrated)("returns true for %s", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(true);
    });

    it("matches bank paths with a query string suffix", () => {
      expect(isMigratedRealmScopedPath("/bank-statements?page=2")).toBe(true);
      expect(isMigratedRealmScopedPath("/bank-statements/abc-123/transactions?dateFrom=2024-02-01")).toBe(true);
    });
  });

  describe("isMigratedTenantScopedPath — triage bypass (#166): clientOrgId-null invoices", () => {
    const tenantBypass = [
      "/invoices/triage",
      "/invoices/triage?status=PENDING_TRIAGE",
      "/invoices/abc-123/assign-client-org",
      "/invoices/abc-123/reject"
    ];

    test.each(tenantBypass)("returns true for %s", (path) => {
      expect(isMigratedTenantScopedPath(path)).toBe(true);
      expect(classifyMigratedPath(path)).toBe(MIGRATED_PATH_KIND.TENANT_SCOPED);
      expect(isMigratedRealmScopedPath(path)).toBe(false);
    });

    it("does not bypass realm-scoping for /reject suffixes outside migrated realm-scoped trees", () => {
      // The suffix bypass only fires when the path also sits under one of the
      // migrated realm-scoped prefixes (e.g. `/invoices/...`). An unrelated
      // `/somewhere-else/reject` stays unclassified by this helper.
      expect(classifyMigratedPath("/somewhere-else/reject")).toBe(MIGRATED_PATH_KIND.NONE);
    });

    it("does not bypass realm-scoping for /workflow-reject (suffix is exactly `/reject`)", () => {
      // `/invoices/abc-123/workflow-reject` ends with `-reject`, NOT `/reject`.
      // The boundary check ensures workflow approval mutations stay
      // realm-scoped.
      expect(isMigratedRealmScopedPath("/invoices/abc-123/workflow-reject")).toBe(true);
      expect(isMigratedTenantScopedPath("/invoices/abc-123/workflow-reject")).toBe(false);
    });
  });

  describe("classifyMigratedPath — non-migrated paths fall through to legacy interceptor", () => {
    const nonMigrated = [
      "/payments",
      "/admin/notification-config",
      "/auth/token",
      "/session",
      "/healthz",
      // Unscoped compliance metadata routes stay on the legacy mount.
      "/compliance/tds-sections",
      "/compliance/risk-signals",
      "/compliance/tds-rates",
      // analytics still goes through the legacy classifier (deferred follow-up #222).
      "/analytics/overview"
    ];

    test.each(nonMigrated)("classifies %s as NONE (legacy ?clientOrgId= path)", (path) => {
      expect(classifyMigratedPath(path)).toBe(MIGRATED_PATH_KIND.NONE);
      expect(isMigratedRealmScopedPath(path)).toBe(false);
      expect(isMigratedTenantScopedPath(path)).toBe(false);
    });

    it("does not match prefix substrings outside a path-segment boundary", () => {
      // /exports-archive must NOT match /exports.
      expect(classifyMigratedPath("/exports-archive")).toBe(MIGRATED_PATH_KIND.NONE);
      // /export-config-history must NOT match /export-config.
      expect(classifyMigratedPath("/export-config-history")).toBe(MIGRATED_PATH_KIND.NONE);
      // /jobs/upload-foo must NOT match /jobs/upload exactly.
      expect(isMigratedRealmScopedPath("/jobs/upload-foo")).toBe(false);
      // /vendors-archive must NOT match /vendors.
      expect(isMigratedRealmScopedPath("/vendors-archive")).toBe(false);
      // /admin/gl-codes-archive must NOT match /admin/gl-codes.
      expect(isMigratedRealmScopedPath("/admin/gl-codes-archive")).toBe(false);
      // /bank-statements-archive must NOT match /bank-statements.
      expect(isMigratedRealmScopedPath("/bank-statements-archive")).toBe(false);
      // /bank-accounts-archive must NOT match /bank-accounts.
      expect(isMigratedRealmScopedPath("/bank-accounts-archive")).toBe(false);
      // /invoices-archive must NOT match /invoices.
      expect(classifyMigratedPath("/invoices-archive")).toBe(MIGRATED_PATH_KIND.NONE);
    });
  });

  describe("isMigratedTenantScopedPath — non-migrated paths fall through", () => {
    const nonMigrated = [
      "/exports/tally",
      "/jobs/upload",
      "/auth/token",
      "/session"
    ];

    test.each(nonMigrated)("returns false for %s", (path) => {
      expect(isMigratedTenantScopedPath(path)).toBe(false);
    });

    it("does not match prefix substrings outside a path-segment boundary", () => {
      expect(isMigratedTenantScopedPath("/jobs/ingest-foo")).toBe(false);
      expect(isMigratedTenantScopedPath("/uploads/presign-foo")).toBe(false);
    });
  });

  describe("rewriteToNestedShape (realm-scoped: tenants/:tenantId/clientOrgs/:clientOrgId/...)", () => {
    it("rewrites a leading-slash path into the realm-scoped nested shape", () => {
      expect(rewriteToNestedShape("/exports/tally", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/exports/tally"
      );
    });

    it("rewrites the bare prefix path", () => {
      expect(rewriteToNestedShape("/export-config", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/export-config"
      );
    });

    it("preserves the query string (interceptor passes the full URL through)", () => {
      expect(rewriteToNestedShape("/exports/tally/history?page=2", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/exports/tally/history?page=2"
      );
    });

    it("normalises a missing leading slash by adding one", () => {
      expect(rewriteToNestedShape("exports/tally", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/exports/tally"
      );
    });

    it("rewrites the ingestion upload path", () => {
      expect(rewriteToNestedShape("/jobs/upload/by-keys", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/jobs/upload/by-keys"
      );
    });

    it("rewrites invoice CRUD paths into the realm-scoped nested shape", () => {
      expect(rewriteToNestedShape("/invoices", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/invoices"
      );
      expect(rewriteToNestedShape("/invoices/abc-123", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/invoices/abc-123"
      );
      expect(rewriteToNestedShape("/admin/approval-workflow", "tenant-1", "org-9")).toBe(
        "/tenants/tenant-1/clientOrgs/org-9/admin/approval-workflow"
      );
    });
  });

  describe("rewriteToTenantShape (tenant-scoped: tenants/:tenantId/...)", () => {
    it("rewrites into the /tenants/:tenantId/... shape (no clientOrgId segment)", () => {
      expect(rewriteToTenantShape("/jobs/ingest", "tenant-1")).toBe(
        "/tenants/tenant-1/jobs/ingest"
      );
    });

    it("preserves nested sub-paths and query strings", () => {
      expect(rewriteToTenantShape("/jobs/ingest/status?live=1", "tenant-1")).toBe(
        "/tenants/tenant-1/jobs/ingest/status?live=1"
      );
    });

    it("rewrites the presign endpoint", () => {
      expect(rewriteToTenantShape("/uploads/presign", "tenant-1")).toBe(
        "/tenants/tenant-1/uploads/presign"
      );
    });

    it("rewrites triage list into the tenant-scoped shape (no clientOrgs segment)", () => {
      expect(rewriteToTenantShape("/invoices/triage", "tenant-1")).toBe(
        "/tenants/tenant-1/invoices/triage"
      );
    });

    it("rewrites triage mutations (assign-client-org / reject) into tenant-scoped shape", () => {
      expect(rewriteToTenantShape("/invoices/abc-123/assign-client-org", "tenant-1")).toBe(
        "/tenants/tenant-1/invoices/abc-123/assign-client-org"
      );
      expect(rewriteToTenantShape("/invoices/abc-123/reject", "tenant-1")).toBe(
        "/tenants/tenant-1/invoices/abc-123/reject"
      );
    });

    it("preserves the query string for triage paths", () => {
      expect(rewriteToTenantShape("/invoices/triage?status=PENDING_TRIAGE", "tenant-1")).toBe(
        "/tenants/tenant-1/invoices/triage?status=PENDING_TRIAGE"
      );
    });

    it("normalises a missing leading slash by adding one", () => {
      expect(rewriteToTenantShape("jobs/ingest", "tenant-1")).toBe(
        "/tenants/tenant-1/jobs/ingest"
      );
    });
  });

  describe("MIGRATED_REALM_SCOPED_PREFIXES — accumulated scope across sub-PRs", () => {
    it("contains export, ingestion-upload, compliance, bank, and invoice domain prefixes", () => {
      expect([...MIGRATED_REALM_SCOPED_PREFIXES]).toEqual([
        "/exports",
        "/export-config",
        "/jobs/upload",
        "/vendors",
        "/admin/gl-codes",
        "/admin/tcs-config",
        "/admin/compliance-config",
        "/bank/accounts",
        "/bank-accounts",
        "/bank-statements",
        "/invoices",
        "/admin/approval-workflow",
        "/admin/approval-limits"
      ]);
    });
  });

  describe("isMigratedTenantScopedPath — tenant domain (#203)", () => {
    const migrated = [
      "/admin/users",
      "/admin/users/invite",
      "/admin/users/abc-123/role",
      "/admin/mailboxes",
      "/admin/mailboxes/abc-123/assign",
      "/admin/client-orgs",
      "/admin/client-orgs/abc-123",
      "/admin/mailbox-assignments",
      "/admin/mailbox-assignments/abc-123/recent-ingestions",
      "/integrations/gmail",
      "/integrations/gmail/connect-url"
    ];

    test.each(migrated)("returns true for %s", (path) => {
      expect(isMigratedTenantScopedPath(path)).toBe(true);
      expect(classifyMigratedPath(path)).toBe(MIGRATED_PATH_KIND.TENANT_SCOPED);
    });

    it("matches a path with a query string suffix", () => {
      expect(isMigratedTenantScopedPath("/admin/client-orgs?includeArchived=true")).toBe(true);
      expect(isMigratedTenantScopedPath("/admin/mailbox-assignments/abc/recent-ingestions?days=30")).toBe(true);
    });

    it("returns false for non-tenant-domain admin/integration paths", () => {
      // Composite-key admin endpoints belong to other vertical slices.
      expect(isMigratedTenantScopedPath("/admin/notification-config")).toBe(false);
      expect(isMigratedTenantScopedPath("/admin/compliance-config")).toBe(false);
      expect(isMigratedTenantScopedPath("/admin/tcs-config")).toBe(false);
      expect(isMigratedTenantScopedPath("/admin/gl-codes")).toBe(false);
      expect(isMigratedTenantScopedPath("/admin/approval-workflow")).toBe(false);
    });

    it("does not match prefix substrings outside a path-segment boundary", () => {
      expect(isMigratedTenantScopedPath("/admin/users-archive")).toBe(false);
      expect(isMigratedTenantScopedPath("/integrations/gmail-legacy")).toBe(false);
      expect(isMigratedTenantScopedPath("/admin/client-orgs-export")).toBe(false);
    });

    it("returns false for unmigrated tenant-scoped paths", () => {
      expect(isMigratedTenantScopedPath("/tenant/onboarding/complete")).toBe(false);
      expect(isMigratedTenantScopedPath("/session")).toBe(false);
      expect(isMigratedTenantScopedPath("/auth/token")).toBe(false);
    });
  });

  describe("rewriteToTenantShape — tenant domain (#203)", () => {
    it("rewrites a tenant-domain path into the /tenants/:tenantId/... shape (no clientOrgs segment)", () => {
      expect(rewriteToTenantShape("/admin/users", "tenant-1")).toBe(
        "/tenants/tenant-1/admin/users"
      );
    });

    it("preserves the query string for tenant-domain paths", () => {
      expect(rewriteToTenantShape("/admin/client-orgs?includeArchived=true", "tenant-1")).toBe(
        "/tenants/tenant-1/admin/client-orgs?includeArchived=true"
      );
    });
  });

  describe("MIGRATED_TENANT_SCOPED_PREFIXES — accumulated tenant-scoped scope", () => {
    it("contains ingestion-orchestration, presign, and tenant-domain prefixes", () => {
      expect([...MIGRATED_TENANT_SCOPED_PREFIXES]).toEqual([
        "/jobs/ingest",
        "/uploads/presign",
        "/admin/users",
        "/admin/mailboxes",
        "/admin/client-orgs",
        "/admin/mailbox-assignments",
        "/integrations/gmail"
      ]);
    });
  });
});
