/**
 * @jest-environment jsdom
 */
import { complianceUrls } from "@/api/urls/complianceUrls";
import { MissingActiveClientOrgError } from "@/api/errors";
import { writeActiveTenantId } from "@/api/tenantStorage";
import { setActiveClientOrgId } from "@/hooks/useActiveClientOrg";

beforeEach(() => {
  writeActiveTenantId("tenant-1");
  setActiveClientOrgId("client-1");
});

afterEach(() => {
  writeActiveTenantId(null);
  setActiveClientOrgId(null);
});

describe("api/urls/complianceUrls — id-bearing routes", () => {
  it("vendorUpdate encodes the vendor id into the nested path", () => {
    expect(complianceUrls.vendorUpdate("vendor/42")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/vendors/vendor%2F42"
    );
  });

  it("glCodeUpdate encodes the gl code into the nested path", () => {
    expect(complianceUrls.glCodeUpdate("GL 100")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/admin/gl-codes/GL%20100"
    );
  });

  it("glCodeDelete encodes the gl code into the nested path", () => {
    expect(complianceUrls.glCodeDelete("GL#7")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/admin/gl-codes/GL%237"
    );
  });
});

describe("api/urls/complianceUrls — missing-context guards", () => {
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => complianceUrls.vendorsList()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.glCodesList()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.vendorUpdate("v-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.approvalWorkflow()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.approvalLimits()).toThrow(
      MissingActiveClientOrgError
    );
  });

  it("throws MissingActiveClientOrgError when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => complianceUrls.tcsConfig()).toThrow(MissingActiveClientOrgError);
    expect(() => complianceUrls.glCodeDelete("GL-1")).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.approvalWorkflow()).toThrow(
      MissingActiveClientOrgError
    );
    expect(() => complianceUrls.approvalLimits()).toThrow(
      MissingActiveClientOrgError
    );
  });
});
