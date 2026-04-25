import { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TenantIntegrationModel } from "@/models/integration/TenantIntegration.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { MailboxAssignmentsAdminService } from "@/services/tenant/mailboxAssignmentsAdminService.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

const TENANT_A = "tenant-mb-a";
const TENANT_B = "tenant-mb-b";
const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "07AABCC1234D1ZA";
const GSTIN_OTHER = "19AAACC1234M1Z2";

async function seedTenantWithIntegration(tenantId: string, email: string) {
  const integration = await TenantIntegrationModel.create({
    tenantId,
    provider: "gmail",
    status: "connected",
    emailAddress: email,
    createdByUserId: "user-x"
  });
  return integration;
}

describeHarness("MailboxAssignmentsAdminService (#174)", ({ getHarness }) => {
  let service: MailboxAssignmentsAdminService;

  beforeAll(async () => {
    await ClientOrganizationModel.syncIndexes();
    await TenantMailboxAssignmentModel.syncIndexes();
    service = new MailboxAssignmentsAdminService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  describe("create", () => {
    it("creates an assignment with validated clientOrgIds[]", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "ca@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const b = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_B, companyName: "B" });

      const created = await service.create({
        tenantId: TENANT_A,
        integrationId: integration._id.toString(),
        clientOrgIds: [a._id.toString(), b._id.toString()]
      });

      expect(created.email).toBe("ca@firm.com");
      expect(created.clientOrgIds).toHaveLength(2);
    });

    it("rejects empty clientOrgIds with 400", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "ca@firm.com");
      await expect(
        service.create({ tenantId: TENANT_A, integrationId: integration._id.toString(), clientOrgIds: [] })
      ).rejects.toMatchObject({ statusCode: 400, code: "mailbox_assignment_client_org_ids_required" });
    });

    it("rejects cross-tenant clientOrgIds element with 400", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "ca@firm.com");
      const otherTenantOrg = await ClientOrganizationModel.create({
        tenantId: TENANT_B,
        gstin: GSTIN_OTHER,
        companyName: "Other"
      });
      await expect(
        service.create({
          tenantId: TENANT_A,
          integrationId: integration._id.toString(),
          clientOrgIds: [otherTenantOrg._id.toString()]
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "mailbox_assignment_cross_tenant_client_org" });
    });

    it("404s for unknown integrationId", async () => {
      await expect(
        service.create({
          tenantId: TENANT_A,
          integrationId: new Types.ObjectId().toString(),
          clientOrgIds: [new Types.ObjectId().toString()]
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "mailbox_integration_not_found" });
    });
  });

  describe("list", () => {
    it("lists only the caller's tenant assignments", async () => {
      const integrationA = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const integrationB = await seedTenantWithIntegration(TENANT_B, "b@firm.com");
      const orgA = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const orgB = await ClientOrganizationModel.create({ tenantId: TENANT_B, gstin: GSTIN_B, companyName: "B" });
      await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integrationA._id, assignedTo: "all", clientOrgIds: [orgA._id]
      });
      await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_B, integrationId: integrationB._id, assignedTo: "all", clientOrgIds: [orgB._id]
      });

      const items = await service.list(TENANT_A);
      expect(items).toHaveLength(1);
      expect(items[0].email).toBe("a@firm.com");
    });
  });

  describe("update", () => {
    it("replaces clientOrgIds[]", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const b = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_B, companyName: "B" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });

      const updated = await service.update({
        tenantId: TENANT_A,
        assignmentId: assignment._id.toString(),
        clientOrgIds: [b._id.toString()]
      });
      expect(updated.clientOrgIds).toEqual([b._id.toString()]);
    });

    it("rejects PATCH with cross-tenant clientOrgId", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const otherTenantOrg = await ClientOrganizationModel.create({
        tenantId: TENANT_B, gstin: GSTIN_OTHER, companyName: "Other"
      });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });

      await expect(
        service.update({
          tenantId: TENANT_A,
          assignmentId: assignment._id.toString(),
          clientOrgIds: [otherTenantOrg._id.toString()]
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "mailbox_assignment_cross_tenant_client_org" });
    });

    it("404s for cross-tenant assignment id", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });
      await expect(
        service.update({
          tenantId: TENANT_B,
          assignmentId: assignment._id.toString(),
          clientOrgIds: [a._id.toString()]
        })
      ).rejects.toMatchObject({ statusCode: 404, code: "mailbox_assignment_not_found" });
    });
  });

  describe("delete", () => {
    it("hard-deletes the assignment", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });
      await service.delete({ tenantId: TENANT_A, assignmentId: assignment._id.toString() });
      const reread = await TenantMailboxAssignmentModel.findById(assignment._id).lean();
      expect(reread).toBeNull();
    });

    it("404s for cross-tenant id", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });
      await expect(
        service.delete({ tenantId: TENANT_B, assignmentId: assignment._id.toString() })
      ).rejects.toMatchObject({ statusCode: 404, code: "mailbox_assignment_not_found" });
    });
  });

  describe("recentIngestions", () => {
    it("returns only invoices in window for the assignment's clientOrgs", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const otherOrg = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_B, companyName: "B" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });

      // In-window invoice for the assignment's org.
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: a._id, sourceType: "email", sourceKey: "k1", sourceDocumentId: "d1",
        attachmentName: "in.pdf", mimeType: "application/pdf", receivedAt: new Date(), status: INVOICE_STATUS.NEEDS_REVIEW
      });
      // Off-window: clientOrgId is otherOrg, not in assignment.
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: otherOrg._id, sourceType: "email", sourceKey: "k2", sourceDocumentId: "d2",
        attachmentName: "out.pdf", mimeType: "application/pdf", receivedAt: new Date(), status: INVOICE_STATUS.NEEDS_REVIEW
      });

      const result = await service.recentIngestions({
        tenantId: TENANT_A, assignmentId: assignment._id.toString(), days: 30
      });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].attachmentName).toBe("in.pdf");
      expect(result.periodDays).toBe(30);
    });

    it("404s for cross-tenant assignment id", async () => {
      const integration = await seedTenantWithIntegration(TENANT_A, "a@firm.com");
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "A" });
      const assignment = await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A, integrationId: integration._id, assignedTo: "all", clientOrgIds: [a._id]
      });
      await expect(
        service.recentIngestions({ tenantId: TENANT_B, assignmentId: assignment._id.toString(), days: 30 })
      ).rejects.toMatchObject({ statusCode: 404, code: "mailbox_assignment_not_found" });
    });
  });
});
