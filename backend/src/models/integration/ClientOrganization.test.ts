import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";

const VALID_GSTIN_A = "29ABCDE1234F1Z5";
const VALID_GSTIN_B = "07AABCC1234D1ZA";

describeHarness("ClientOrganization model (ISSUE-155)", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  it("rejects a second insert with the same {tenantId, gstin} pair", async () => {
    await ClientOrganizationModel.create({
      tenantId: "tenant-1",
      companyName: "ACME",
      gstin: VALID_GSTIN_A
    });

    await expect(
      ClientOrganizationModel.create({
        tenantId: "tenant-1",
        companyName: "ACME Duplicate",
        gstin: VALID_GSTIN_A
      })
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same gstin across different tenants", async () => {
    await ClientOrganizationModel.create({
      tenantId: "tenant-1",
      companyName: "ACME",
      gstin: VALID_GSTIN_A
    });

    await expect(
      ClientOrganizationModel.create({
        tenantId: "tenant-2",
        companyName: "ACME (other CA)",
        gstin: VALID_GSTIN_A
      })
    ).resolves.toBeDefined();
  });

  it("allows different gstins for the same tenant", async () => {
    await ClientOrganizationModel.create({
      tenantId: "tenant-1",
      companyName: "Client A",
      gstin: VALID_GSTIN_A
    });

    await expect(
      ClientOrganizationModel.create({
        tenantId: "tenant-1",
        companyName: "Client B",
        gstin: VALID_GSTIN_B
      })
    ).resolves.toBeDefined();
  });

  it.each([
    ["14-character too short", "29ABCDE1234F1Z"],
    ["lowercase letters", "29abcde1234f1z5"],
    ["empty string", ""]
  ])("rejects gstin with invalid format: %s", async (_label, invalidGstin) => {
    await expect(
      ClientOrganizationModel.create({
        tenantId: "tenant-1",
        companyName: "ACME",
        gstin: invalidGstin
      })
    ).rejects.toThrow();
  });

  it("rejects when gstin is missing (null)", async () => {
    await expect(
      ClientOrganizationModel.create({
        tenantId: "tenant-1",
        companyName: "ACME",
        gstin: null as unknown as string
      })
    ).rejects.toThrow();
  });
});
