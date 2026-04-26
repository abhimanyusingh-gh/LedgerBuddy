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
      "/payments",
      // Composite-key endpoints under otherwise-tenant-scoped trees:
      "/admin/notification-config",
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

    it("classifies migrated compliance paths so they fall through to the migratedPaths interceptor", () => {
      // Compliance domain (#200) migrated to nested-router shape — these are
      // no longer in REALM_SCOPED_PATH_PREFIXES. `/admin/...` paths match the
      // broader `/admin` tenant-scoped prefix (so the interceptor will not try
      // to inject ?clientOrgId=). `/vendors` matches no prefix and is 'unknown'.
      // In all cases the axios interceptor rewrites them via `migratedPaths.ts`
      // BEFORE this classifier is consulted, so the classifier result is moot.
      expect(classifyApiPath("/vendors")).toBe("unknown");
      expect(classifyApiPath("/admin/gl-codes")).toBe("tenant-scoped");
      expect(classifyApiPath("/admin/tcs-config")).toBe("tenant-scoped");
      expect(classifyApiPath("/admin/compliance-config")).toBe("tenant-scoped");
      expect(isRealmScopedPath("/vendors")).toBe(false);
      expect(isRealmScopedPath("/admin/gl-codes")).toBe(false);
    });

    it("classifies unscoped compliance metadata as 'unknown'", () => {
      // /compliance/tds-sections, /compliance/risk-signals, /compliance/tds-rates
      // never required clientOrgId — they remain on the legacy mount but are no
      // longer claimed by REALM_SCOPED_PATH_PREFIXES.
      expect(classifyApiPath("/compliance/tds-sections")).toBe("unknown");
      expect(classifyApiPath("/compliance/risk-signals")).toBe("unknown");
      expect(classifyApiPath("/compliance/tds-rates")).toBe("unknown");
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
    it("does not let /compliance/admin bypass match /compliance/administrators", () => {
      // Pre-fix, naked startsWith on the bypass list would incorrectly match
      // `/compliance/admin` against `/compliance/administrators` and bypass
      // realm-scoping. Exact-prefix matching prevents that. After #200,
      // `/compliance` is no longer a realm-scoped prefix (the only `/compliance/*`
      // BE routes are unscoped metadata), so the path classifies as 'unknown'
      // instead of 'tenant-scoped' — but the asymmetry guard still holds.
      expect(classifyApiPath("/compliance/administrators")).toBe("unknown");
      expect(isRealmScopedPath("/compliance/administrators")).toBe(false);
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
