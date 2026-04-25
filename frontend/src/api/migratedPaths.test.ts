/**
 * Standalone tests for the #171 nested-router migration helpers consumed by
 * the axios request interceptor in `client.ts`. Imported from
 * `migratedPaths.ts` (not `client.ts`) so the tests stay in a pure-node
 * environment — `client.ts` pulls in `import.meta.env` which Jest's CJS
 * runtime can't parse (same workaround pattern as `classifyApiPath.test.ts`).
 *
 * These tests assert two complementary contracts:
 *   1. For migrated paths (export domain, sub-PR 1), the helper detects the
 *      path AND rewrites it into the new nested shape that the BE expects.
 *   2. For NON-migrated paths (everything else), the helper returns false so
 *      the interceptor falls through to the legacy `?clientOrgId=` query
 *      injection branch (covered by classifyApiPath.test.ts).
 */
import {
  MIGRATED_REALM_SCOPED_PREFIXES,
  isMigratedRealmScopedPath,
  rewriteToNestedShape
} from "@/api/migratedPaths";

describe("api/migratedPaths", () => {
  describe("isMigratedRealmScopedPath — migrated paths (export domain)", () => {
    const migrated = [
      "/exports",
      "/exports/tally",
      "/exports/tally/download",
      "/exports/tally/history",
      "/exports/tally/download/batch-123",
      "/exports/csv",
      "/export-config"
    ];

    test.each(migrated)("returns true for %s", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(true);
    });

    it("matches a path with a query string suffix", () => {
      expect(isMigratedRealmScopedPath("/exports/tally/history?page=2")).toBe(true);
      expect(isMigratedRealmScopedPath("/export-config?fields=tallyCompanyName")).toBe(true);
    });
  });

  describe("isMigratedRealmScopedPath — non-migrated paths fall through to legacy interceptor", () => {
    const nonMigrated = [
      "/invoices",
      "/invoices/abc-123",
      "/vendors",
      "/payments",
      "/bank-statements",
      "/admin/notification-config",
      "/admin/users",
      "/auth/token",
      "/session",
      "/healthz"
    ];

    test.each(nonMigrated)("returns false for %s (legacy ?clientOrgId= path)", (path) => {
      expect(isMigratedRealmScopedPath(path)).toBe(false);
    });

    it("does not match prefix substrings outside a path-segment boundary", () => {
      // /exports-archive must NOT match /exports.
      expect(isMigratedRealmScopedPath("/exports-archive")).toBe(false);
      // /export-config-history must NOT match /export-config.
      expect(isMigratedRealmScopedPath("/export-config-history")).toBe(false);
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
  });

  describe("MIGRATED_REALM_SCOPED_PREFIXES — sub-PR 1 scope", () => {
    it("contains exactly the export domain prefixes (subsequent sub-PRs add more)", () => {
      expect([...MIGRATED_REALM_SCOPED_PREFIXES]).toEqual(["/exports", "/export-config"]);
    });
  });
});
