import { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { resolveClientOrgForIngestion } from "@/services/ingestion/resolveClientOrg.js";

const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "07AABCC1234D1ZA";
const GSTIN_C = "19AAACC1234M1Z2";
const TENANT = "tenant-resolver";

describeHarness("resolveClientOrgForIngestion (ISSUE-159)", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  it("returns the single clientOrg whose gstin matches parsed.customerGstin (1-of-N candidates)", async () => {
    const a = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "A", gstin: GSTIN_A });
    const b = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "B", gstin: GSTIN_B });
    const c = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "C", gstin: GSTIN_C });

    const result = await resolveClientOrgForIngestion(
      { customerGstin: GSTIN_B },
      { _id: new Types.ObjectId(), tenantId: TENANT, clientOrgIds: [a._id, b._id, c._id] }
    );

    expect(result.triage).toBe(false);
    expect(result.reason).toBe("gstin_match");
    expect(String(result.clientOrgId)).toBe(String(b._id));
  });

  it("falls back to the sole candidate when gstin does not match (single-candidate path)", async () => {
    const a = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "A", gstin: GSTIN_A });

    const result = await resolveClientOrgForIngestion(
      { customerGstin: undefined },
      { _id: new Types.ObjectId(), tenantId: TENANT, clientOrgIds: [a._id] }
    );

    expect(result.triage).toBe(false);
    expect(result.reason).toBe("single_candidate");
    expect(String(result.clientOrgId)).toBe(String(a._id));
  });

  it("lands in PENDING_TRIAGE when gstin misses and the assignment carries multiple candidates", async () => {
    const a = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "A", gstin: GSTIN_A });
    const b = await ClientOrganizationModel.create({ tenantId: TENANT, companyName: "B", gstin: GSTIN_B });

    const result = await resolveClientOrgForIngestion(
      { customerGstin: "27AAAAA0000A1Z5" }, // not in candidates
      { _id: new Types.ObjectId(), tenantId: TENANT, clientOrgIds: [a._id, b._id] }
    );

    expect(result.triage).toBe(true);
    expect(result.reason).toBe("multi_candidate_triage");
    expect(result.clientOrgId).toBeNull();
  });

  it("rejects an empty clientOrgIds assignment (invariant violation — schema minLength 1)", async () => {
    await expect(
      resolveClientOrgForIngestion(
        { customerGstin: GSTIN_A },
        { _id: new Types.ObjectId(), tenantId: TENANT, clientOrgIds: [] as unknown as Types.ObjectId[] }
      )
    ).rejects.toThrow(/no clientOrgIds/i);
  });
});
