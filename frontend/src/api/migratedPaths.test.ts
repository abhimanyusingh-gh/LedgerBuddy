/**
 * Standalone tests for the #171 nested-router migration helpers consumed by
 * the axios request interceptor in `client.ts`. Imported from
 * `migratedPaths.ts` (not `client.ts`) so the tests stay in a pure-node
 * environment — `client.ts` pulls in `import.meta.env` which Jest's CJS
 * runtime can't parse (same workaround pattern as `classifyApiPath.test.ts`).
 *
 * These tests assert two complementary contracts:
 *   1. For migrated paths (export domain sub-PR 1, ingestion sub-PR 2), the
 *      helper detects the path AND rewrites it into the new nested shape that
 *      the BE expects.
 *   2. For NON-migrated paths (everything else), the helper returns false so
 *      the interceptor falls through to the legacy `?clientOrgId=` query
 *      injection branch (covered by classifyApiPath.test.ts).
 */
import {
  MIGRATED_REALM_SCOPED_PREFIXES,
  MIGRATED_TENANT_SCOPED_PREFIXES,
  isMigratedRealmScopedPath,
  isMigratedTenantScopedPath,
  rewriteToNestedShape,
  rewriteToTenantShape
} from "@/api/migratedPaths";

describe("api/migratedPaths", () => {
  describe("isMigratedRealmScopedPath — migrated paths (export + ingestion-upload + compliance domains)", () => {
    const migrated = [
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
      "/vendors",
      "/vendors/v-1",
      "/admin/gl-codes",
      "/admin/gl-codes/SOMECODE",
      "/admin/gl-codes/import-csv",
      "/admin/tcs-config",
      "/admin/tcs-config/roles",
      "/admin/tcs-config/history",
      "/admin/compliance-config"
    ];

    test.each(migrated)("returns true for %s", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(true);
    });

    it("matches a path with a query string suffix", () => {
      expect(isMigratedRealmScopedPath("/exports/tally/history?page=2")).toBe(true);
      expect(isMigratedRealmScopedPath("/export-config?fields=tallyCompanyName")).toBe(true);
      expect(isMigratedRealmScopedPath("/vendors?search=acme")).toBe(true);
      expect(isMigratedRealmScopedPath("/admin/gl-codes?limit=200")).toBe(true);
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

  describe("isMigratedRealmScopedPath — non-migrated paths fall through to legacy interceptor", () => {
    const nonMigrated = [
      "/invoices",
      "/invoices/abc-123",
      "/payments",
      "/admin/notification-config",
      "/admin/users",
      "/auth/token",
      "/session",
      "/healthz",
      // Ingestion: tenant-scoped paths are NOT realm-scoped.
      "/jobs/ingest",
      "/uploads/presign",
      // Unscoped compliance metadata routes stay on the legacy mount.
      "/compliance/tds-sections",
      "/compliance/risk-signals",
      "/compliance/tds-rates"
    ];

    test.each(nonMigrated)("returns false for %s (legacy ?clientOrgId= path)", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(false);
    });

    it("does not match prefix substrings outside a path-segment boundary", () => {
      // /exports-archive must NOT match /exports.
      expect(isMigratedRealmScopedPath("/exports-archive")).toBe(false);
      // /export-config-history must NOT match /export-config.
      expect(isMigratedRealmScopedPath("/export-config-history")).toBe(false);
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
    });
  });

  describe("isMigratedTenantScopedPath — non-migrated paths fall through", () => {
    const nonMigrated = [
      "/invoices",
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

  describe("rewriteToNestedShape", () => {
    it("rewrites a leading-slash path into the /tenants/:tenantId/clientOrgs/:clientOrgId/... shape", () => {
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
  });

  describe("rewriteToTenantShape", () => {
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

    it("normalises a missing leading slash by adding one", () => {
      expect(rewriteToTenantShape("jobs/ingest", "tenant-1")).toBe(
        "/tenants/tenant-1/jobs/ingest"
      );
    });
  });

  describe("MIGRATED_REALM_SCOPED_PREFIXES — accumulated scope across sub-PRs", () => {
    it("contains export, ingestion-upload, compliance, and bank domain prefixes", () => {
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
        "/bank-statements"
      ]);
    });
  });

  describe("MIGRATED_TENANT_SCOPED_PREFIXES — sub-PR 2 scope", () => {
    it("contains ingestion-orchestration and presign prefixes", () => {
      expect([...MIGRATED_TENANT_SCOPED_PREFIXES]).toEqual([
        "/jobs/ingest",
        "/uploads/presign"
      ]);
    });
  });
});
