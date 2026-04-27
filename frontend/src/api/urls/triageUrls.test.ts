/**
 * @jest-environment jsdom
 */
import { triageUrls } from "@/api/urls/triageUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId(null);
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/triageUrls — tenant-scoped routes", () => {
  it("triageList resolves to the tenant-scoped triage path", () => {
    expect(triageUrls.triageList()).toBe("/tenants/tenant-1/invoices/triage");
  });

  it("assignClientOrg encodes the invoice id into the tenant-scoped path", () => {
    expect(triageUrls.assignClientOrg("inv/9")).toBe(
      "/tenants/tenant-1/invoices/inv%2F9/assign-client-org"
    );
  });

  it("reject encodes the invoice id into the tenant-scoped path", () => {
    expect(triageUrls.reject("inv 7")).toBe(
      "/tenants/tenant-1/invoices/inv%207/reject"
    );
  });

  it("does not require an active clientOrgId (PENDING_TRIAGE bypass)", () => {
    expect(triageUrls.triageList()).toContain("/tenants/tenant-1/");
    expect(triageUrls.assignClientOrg("inv-1")).toContain("/tenants/tenant-1/");
  });
});

describe("api/urls/triageUrls — missing-context guards", () => {
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => triageUrls.triageList()).toThrow(MissingActiveClientOrgError);
    expect(() => triageUrls.assignClientOrg("inv-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => triageUrls.reject("inv-1")).toThrow(
      MissingActiveClientOrgError
    );
  });
});
