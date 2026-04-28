/**
 * @jest-environment jsdom
 */
import { buildClientOrgPathUrl, buildTenantPathUrl } from "@/api/urls/pathBuilder";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("org-9");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/pathBuilder — buildClientOrgPathUrl (realm-scoped)", () => {
  it("rewrites a leading-slash path into the realm-scoped nested shape", () => {
    expect(buildClientOrgPathUrl("/exports/tally")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/exports/tally"
    );
  });

  it("rewrites the bare prefix path", () => {
    expect(buildClientOrgPathUrl("/export-config")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/export-config"
    );
  });

  it("preserves the query string", () => {
    expect(buildClientOrgPathUrl("/exports/tally/history?page=2")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/exports/tally/history?page=2"
    );
  });

  it("normalises a missing leading slash by adding one", () => {
    expect(buildClientOrgPathUrl("exports/tally")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/exports/tally"
    );
  });

  it("rewrites the ingestion upload path", () => {
    expect(buildClientOrgPathUrl("/jobs/upload/by-keys")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/jobs/upload/by-keys"
    );
  });

  it("rewrites invoice CRUD paths into the realm-scoped nested shape", () => {
    expect(buildClientOrgPathUrl("/invoices")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/invoices"
    );
    expect(buildClientOrgPathUrl("/invoices/abc-123")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/invoices/abc-123"
    );
    expect(buildClientOrgPathUrl("/admin/approval-workflow")).toBe(
      "/tenants/tenant-1/clientOrgs/org-9/admin/approval-workflow"
    );
  });

  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => buildClientOrgPathUrl("/invoices")).toThrow(MissingActiveClientOrgError);
  });

  it("throws MissingActiveClientOrgError when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => buildClientOrgPathUrl("/invoices")).toThrow(MissingActiveClientOrgError);
  });
});

describe("api/urls/pathBuilder — buildTenantPathUrl (tenant-scoped)", () => {
  it("rewrites into the /tenants/:tenantId/... shape (no clientOrgId segment)", () => {
    expect(buildTenantPathUrl("/jobs/ingest")).toBe("/tenants/tenant-1/jobs/ingest");
  });

  it("preserves nested sub-paths and query strings", () => {
    expect(buildTenantPathUrl("/jobs/ingest/status?live=1")).toBe(
      "/tenants/tenant-1/jobs/ingest/status?live=1"
    );
  });

  it("rewrites the presign endpoint", () => {
    expect(buildTenantPathUrl("/uploads/presign")).toBe("/tenants/tenant-1/uploads/presign");
  });

  it("rewrites triage list into the tenant-scoped shape (no clientOrgs segment)", () => {
    expect(buildTenantPathUrl("/invoices/triage")).toBe(
      "/tenants/tenant-1/invoices/triage"
    );
  });

  it("rewrites triage mutations (assign-client-org / reject) into tenant-scoped shape", () => {
    expect(buildTenantPathUrl("/invoices/abc-123/assign-client-org")).toBe(
      "/tenants/tenant-1/invoices/abc-123/assign-client-org"
    );
    expect(buildTenantPathUrl("/invoices/abc-123/reject")).toBe(
      "/tenants/tenant-1/invoices/abc-123/reject"
    );
  });

  it("preserves the query string for triage paths", () => {
    expect(buildTenantPathUrl("/invoices/triage?status=PENDING_TRIAGE")).toBe(
      "/tenants/tenant-1/invoices/triage?status=PENDING_TRIAGE"
    );
  });

  it("normalises a missing leading slash by adding one", () => {
    expect(buildTenantPathUrl("jobs/ingest")).toBe("/tenants/tenant-1/jobs/ingest");
  });

  it("rewrites tenant-domain admin paths (no clientOrgs segment)", () => {
    expect(buildTenantPathUrl("/admin/users")).toBe("/tenants/tenant-1/admin/users");
    expect(buildTenantPathUrl("/admin/client-orgs?includeArchived=true")).toBe(
      "/tenants/tenant-1/admin/client-orgs?includeArchived=true"
    );
  });

  it("rewrites the analytics overview endpoint and preserves the optional clientOrgId query param", () => {
    expect(buildTenantPathUrl("/analytics/overview")).toBe(
      "/tenants/tenant-1/analytics/overview"
    );
    expect(
      buildTenantPathUrl(
        "/analytics/overview?clientOrgId=65a1b2c3d4e5f6a7b8c9d0e1&from=2026-04-01"
      )
    ).toBe(
      "/tenants/tenant-1/analytics/overview?clientOrgId=65a1b2c3d4e5f6a7b8c9d0e1&from=2026-04-01"
    );
  });

  it("resolves even when clientOrgId is unset (tenant-scoped only)", () => {
    setActiveClientOrgId(null);
    expect(buildTenantPathUrl("/jobs/ingest")).toBe("/tenants/tenant-1/jobs/ingest");
  });

  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => buildTenantPathUrl("/jobs/ingest")).toThrow(MissingActiveClientOrgError);
  });
});
