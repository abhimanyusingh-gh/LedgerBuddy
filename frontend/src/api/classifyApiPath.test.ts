/**
 * Standalone classifier tests for `classifyApiPath` / `isRealmScopedPath`.
 *
 * Both the realm-scoped allow-list and the bypass list use the same
 * exact-prefix strategy (`path === prefix || path.startsWith(prefix + "/")`),
 * so look-alike paths like `/compliance/administrators` cannot accidentally
 * be classified by `/compliance/admin`.
 *
 * Imported from `classifyApiPath.ts` (not `client.ts`) so the test stays in a
 * pure-node environment — `client.ts` pulls in `import.meta.env` which Jest's
 * CJS runtime can't parse.
 */
import { classifyApiPath, isRealmScopedPath } from "@/api/classifyApiPath";

describe("api/client classifier", () => {
  describe("realm-scoped paths (require active clientOrgId)", () => {
    const realmScoped = [
      "/invoices",
      "/invoices/abc-123",
      "/invoices/abc-123/workflow-approve",
      "/vendors",
      "/vendors/v-1",
      "/payments",
      "/bank-statements",
      "/bank-statements/upload",
      "/bank-accounts",
      "/bank/accounts",
      "/bank/accounts/abc/refresh",
      "/compliance",
      "/compliance/risk-signals",
      "/compliance/tds-rates",
      // Composite-key endpoints under otherwise-tenant-scoped trees:
      "/admin/notification-config",
      "/admin/compliance-config",
      "/admin/tcs-config",
      "/admin/tcs-config/roles",
      "/admin/tcs-config/history",
      "/admin/gl-codes",
      "/admin/gl-codes/import-csv",
      "/admin/gl-codes/SOMECODE",
      "/admin/approval-limits",
      "/admin/approval-workflow"
    ];

    test.each(realmScoped)("classifies %s as realm-scoped", (path) => {
      expect(classifyApiPath(path)).toBe("realm-scoped");
      expect(isRealmScopedPath(path)).toBe(true);
    });

    it("strips query string before classifying", () => {
      expect(classifyApiPath("/invoices?status=pending")).toBe("realm-scoped");
      expect(isRealmScopedPath("/invoices?status=pending")).toBe(true);
    });
  });

  describe("tenant-scoped paths (no clientOrgId required)", () => {
    const tenantScoped = [
      "/admin/users",
      "/admin/users/u-1/role",
      "/admin/mailboxes",
      // Onboarding (#150) — tenant-scoped surface that lists ALL of the
      // tenant's ClientOrganizations; no clientOrgId filter required.
      "/admin/client-orgs",
      "/admin/client-orgs/abc-123",
      "/auth/token",
      "/auth/change-password",
      "/integrations/gmail",
      "/integrations/gmail/connect-url",
      // Ingestion paths (`/jobs/ingest`, `/jobs/upload`, `/uploads/presign`)
      // moved to the migrated-paths layer in #198 sub-PR 2 — covered by
      // `migratedPaths.test.ts`. The classifier now returns `unknown` for
      // them, which the interceptor treats as "no clientOrgId injection".
      "/tenant/onboarding/complete",
      "/platform/tenants/usage",
      "/analytics/overview",
      "/session"
    ];

    test.each(tenantScoped)("classifies %s as tenant-scoped", (path) => {
      expect(classifyApiPath(path)).toBe("tenant-scoped");
      expect(isRealmScopedPath(path)).toBe(false);
    });

    it("classifies the bypass route /compliance/admin as tenant-scoped", () => {
      expect(classifyApiPath("/compliance/admin")).toBe("tenant-scoped");
      expect(classifyApiPath("/compliance/admin/anything")).toBe("tenant-scoped");
      expect(isRealmScopedPath("/compliance/admin")).toBe(false);
    });

    describe("triage bypass (#166) — invoices with clientOrgId: null", () => {
      it("classifies the triage list /invoices/triage as tenant-scoped", () => {
        expect(classifyApiPath("/invoices/triage")).toBe("tenant-scoped");
        expect(classifyApiPath("/invoices/triage?status=PENDING_TRIAGE")).toBe("tenant-scoped");
        expect(isRealmScopedPath("/invoices/triage")).toBe(false);
      });

      it("classifies /invoices/:id/assign-client-org as tenant-scoped", () => {
        expect(classifyApiPath("/invoices/abc-123/assign-client-org")).toBe("tenant-scoped");
        expect(isRealmScopedPath("/invoices/abc-123/assign-client-org")).toBe(false);
      });

      it("classifies /invoices/:id/reject as tenant-scoped", () => {
        expect(classifyApiPath("/invoices/abc-123/reject")).toBe("tenant-scoped");
        expect(isRealmScopedPath("/invoices/abc-123/reject")).toBe(false);
      });

      it("does not bypass realm-scoping for unrelated suffix matches outside realm-scoped trees", () => {
        // The suffix-bypass only applies to paths that ALSO sit under a realm-scoped prefix.
        expect(classifyApiPath("/somewhere-else/reject")).toBe("unknown");
      });
    });
  });

  describe("edge case: bypass-vs-allow asymmetry (the original bug)", () => {
    it("classifies /compliance/administrators as realm-scoped (NOT bypassed)", () => {
      // Pre-fix, naked startsWith on the bypass list would incorrectly match
      // `/compliance/admin` against `/compliance/administrators` and bypass
      // realm-scoping. Exact-prefix matching prevents that.
      expect(classifyApiPath("/compliance/administrators")).toBe("realm-scoped");
      expect(isRealmScopedPath("/compliance/administrators")).toBe(true);
    });

    it("does not match a prefix that is only a substring of a path segment", () => {
      // `/invoices-archive` should NOT be matched by the `/invoices` prefix.
      expect(classifyApiPath("/invoices-archive")).toBe("unknown");
      expect(isRealmScopedPath("/invoices-archive")).toBe(false);
    });

    it("does not match a prefix that is only a substring of a tenant-scoped path", () => {
      // `/admin-tools` should NOT be matched by the `/admin` prefix.
      expect(classifyApiPath("/admin-tools")).toBe("unknown");
    });
  });

  describe("unknown paths", () => {
    it("returns 'unknown' for paths in neither list", () => {
      expect(classifyApiPath("/healthz")).toBe("unknown");
      expect(classifyApiPath("/")).toBe("unknown");
      expect(classifyApiPath("")).toBe("unknown");
    });

    it("treats unknown paths as not realm-scoped (no param injected)", () => {
      expect(isRealmScopedPath("/healthz")).toBe(false);
    });
  });
});
