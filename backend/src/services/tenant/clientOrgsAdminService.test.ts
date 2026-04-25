import { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "07AABCC1234D1ZA";
const TENANT_A = "tenant-admin-a";
const TENANT_B = "tenant-admin-b";

describeHarness("ClientOrgsAdminService (#174)", ({ getHarness }) => {
  let service: ClientOrgsAdminService;

  beforeAll(async () => {
    await ClientOrganizationModel.syncIndexes();
    service = new ClientOrgsAdminService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  describe("list", () => {
    it("returns only the caller's tenant client-orgs sorted by companyName asc", async () => {
      await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "Zeta" });
      await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_B, companyName: "Alpha" });
      await ClientOrganizationModel.create({ tenantId: TENANT_B, gstin: GSTIN_A, companyName: "Other-tenant" });

      const items = await service.list(TENANT_A);
      expect(items.map((i) => i.companyName)).toEqual(["Alpha", "Zeta"]);
      expect(items.every((i) => i.companyName !== "Other-tenant")).toBe(true);
    });
  });

  describe("create", () => {
    it("creates a new client-org with archivedAt=null and returns the picker shape", async () => {
      const created = await service.create({
        tenantId: TENANT_A,
        gstin: GSTIN_A,
        companyName: "ACME"
      });
      expect(created.gstin).toBe(GSTIN_A);
      expect(created.companyName).toBe("ACME");
      expect(created.archivedAt).toBeNull();
      expect(created.f12OverwriteByGuidVerified).toBe(false);
    });

    it("rejects invalid GSTIN format with 400", async () => {
      await expect(
        service.create({ tenantId: TENANT_A, gstin: "not-a-gstin", companyName: "ACME" })
      ).rejects.toMatchObject({ statusCode: 400, code: "client_org_invalid_gstin" });
    });

    it("rejects duplicate {tenantId, gstin} with 409", async () => {
      await service.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await expect(
        service.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME 2" })
      ).rejects.toMatchObject({ statusCode: 409, code: "client_org_duplicate_gstin" });
    });
  });

  describe("update", () => {
    it("updates mutable fields and ignores cross-tenant docs (404)", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      const updated = await service.update({
        tenantId: TENANT_A,
        clientOrgId: a._id.toString(),
        companyName: "ACME Renamed",
        f12OverwriteByGuidVerified: true
      });
      expect(updated.companyName).toBe("ACME Renamed");
      expect(updated.f12OverwriteByGuidVerified).toBe(true);

      await expect(
        service.update({ tenantId: TENANT_B, clientOrgId: a._id.toString(), companyName: "Hijack" })
      ).rejects.toMatchObject({ statusCode: 404, code: "client_org_not_found" });
    });
  });

  describe("deleteOrArchive", () => {
    it("hard-deletes when no dependents exist", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      const result = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(result.status).toBe("deleted");
      expect(await ClientOrganizationModel.findById(a._id).lean()).toBeNull();
    });

    it("soft-archives + returns linked counts when invoices exist", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      // Use a triage invoice — its clientOrgId can be the one we are about
      // to delete, no need to fully populate the invoice.
      await InvoiceModel.create({
        tenantId: TENANT_A,
        clientOrgId: a._id,
        sourceType: "upload",
        sourceKey: "test-source",
        sourceDocumentId: "doc-1",
        attachmentName: "x.pdf",
        mimeType: "application/pdf",
        receivedAt: new Date(),
        status: INVOICE_STATUS.NEEDS_REVIEW
      });

      const result = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(result.status).toBe("archived");
      expect(result.linkedCounts.invoices).toBe(1);

      const reread = await ClientOrganizationModel.findById(a._id).lean();
      expect(reread?.archivedAt).toBeInstanceOf(Date);
    });

    it("soft-archives when a mailbox-assignment references the org", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A,
        integrationId: new Types.ObjectId(),
        assignedTo: "all",
        clientOrgIds: [a._id]
      });
      const result = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(result.status).toBe("archived");
      expect(result.linkedCounts.mailboxAssignments).toBe(1);
    });

    it("404s for cross-tenant id", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await expect(
        service.deleteOrArchive({ tenantId: TENANT_B, clientOrgId: a._id.toString() })
      ).rejects.toMatchObject({ statusCode: 404, code: "client_org_not_found" });
    });
  });
});
