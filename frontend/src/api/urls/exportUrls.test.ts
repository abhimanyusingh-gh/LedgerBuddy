/**
 * @jest-environment jsdom
 */
import { exportUrls } from "@/api/urls/exportUrls";
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

describe("api/urls/exportUrls — id-bearing routes", () => {
  it("tallyDownloadResult encodes the batch id into the nested path", () => {
    expect(exportUrls.tallyDownloadResult("batch/42")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/exports/tally/download/batch%2F42"
    );
  });

  it("tallyDownloadResult encodes spaces and # characters", () => {
    expect(exportUrls.tallyDownloadResult("batch 7#a")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/exports/tally/download/batch%207%23a"
    );
  });

  it("tallyRetryByBatchId encodes the batch id into the nested retry path", () => {
    expect(exportUrls.tallyRetryByBatchId("batch/42")).toBe(
      "/tenants/tenant-1/clientOrgs/client-1/exports/tally/batches/batch%2F42/retry"
    );
  });
});

describe("api/urls/exportUrls — missing-context guards", () => {
  it("throws MissingActiveClientOrgError when tenantId is unset", () => {
    writeActiveTenantId(null);
    expect(() => exportUrls.tallyDownloadStart()).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyHistory()).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyDownloadResult("b-1")).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyRetryByBatchId("b-1")).toThrow(MissingActiveClientOrgError);
  });

  it("throws MissingActiveClientOrgError when clientOrgId is unset", () => {
    setActiveClientOrgId(null);
    expect(() => exportUrls.tallyDownloadStart()).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyHistory()).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyDownloadResult("b-1")).toThrow(MissingActiveClientOrgError);
    expect(() => exportUrls.tallyRetryByBatchId("b-1")).toThrow(MissingActiveClientOrgError);
  });
});
