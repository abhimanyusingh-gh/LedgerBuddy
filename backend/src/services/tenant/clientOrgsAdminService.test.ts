import mongoose, { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import { CLIENT_ORG_DEPENDENT_MODELS } from "@/services/tenant/clientOrgDependents.js";
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

    it("excludes archived rows by default and includes them with includeArchived=true", async () => {
      const live = await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_A, companyName: "Live"
      });
      await ClientOrganizationModel.create({
        tenantId: TENANT_A, gstin: GSTIN_B, companyName: "Archived", archivedAt: new Date()
      });

      const defaultItems = await service.list(TENANT_A);
      expect(defaultItems.map((i) => i._id)).toEqual([String(live._id)]);

      const allItems = await service.list(TENANT_A, { includeArchived: true });
      expect(allItems.map((i) => i.companyName).sort()).toEqual(["Archived", "Live"]);
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

    it("rejects gstin edits at the service layer with client_org_gstin_immutable", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await expect(
        service.update({
          tenantId: TENANT_A,
          clientOrgId: a._id.toString(),
          gstin: GSTIN_B
        })
      ).rejects.toMatchObject({ statusCode: 400, code: "client_org_gstin_immutable" });
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

    it("re-archive of already-archived org is idempotent (preserves original archivedAt)", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: a._id, sourceType: "upload", sourceKey: "k", sourceDocumentId: "d",
        attachmentName: "x.pdf", mimeType: "application/pdf", receivedAt: new Date(),
        status: INVOICE_STATUS.NEEDS_REVIEW
      });
      const first = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(first.status).toBe("archived");
      const archivedAfterFirst = (await ClientOrganizationModel.findById(a._id).lean())?.archivedAt;
      expect(archivedAfterFirst).toBeInstanceOf(Date);

      await new Promise((r) => setTimeout(r, 5));

      const second = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(second.status).toBe("archived");
      expect(second.linkedCounts.invoices).toBe(1);
      const archivedAfterSecond = (await ClientOrganizationModel.findById(a._id).lean())?.archivedAt;
      expect(archivedAfterSecond?.getTime()).toBe(archivedAfterFirst?.getTime());
    });
  });

  describe("dependency registry coverage (BLOCKER drift detection)", () => {
    /**
     * Drift fixture: every Mongoose model registered in the codebase
     * whose schema declares `clientOrgId` as required (or has a
     * required `clientOrgIds[]`) MUST appear in
     * `CLIENT_ORG_DEPENDENT_MODELS`. Otherwise hard-delete will silently
     * orphan rows that then violate `validateClientOrgTenantInvariant`.
     *
     * We rely on the fact that the registry imports every dependent
     * model file at module-load — so by the time this test runs,
     * Mongoose has registered every dependent. We then sweep
     * `mongoose.modelNames()` and assert the set is a subset of the
     * registry.
     */
    it("registers every required clientOrgId/clientOrgIds model loaded in mongoose", () => {
      // Touch the registry to ensure every dependent file is module-loaded.
      expect(CLIENT_ORG_DEPENDENT_MODELS.length).toBeGreaterThan(0);

      const registeredNames = new Set(
        CLIENT_ORG_DEPENDENT_MODELS.map((entry) => entry.model.modelName)
      );

      const missing: string[] = [];
      for (const name of mongoose.modelNames()) {
        const m = mongoose.model(name);
        const schema = m.schema;
        const singlePath = schema.path("clientOrgId");
        const arrayPath = schema.path("clientOrgIds");

        const singleRequired =
          !!singlePath && Boolean((singlePath as unknown as { isRequired?: boolean }).isRequired);
        const arrayRequired =
          !!arrayPath && Boolean((arrayPath as unknown as { isRequired?: boolean }).isRequired);

        if (!singleRequired && !arrayRequired) continue;
        if (!registeredNames.has(name)) missing.push(name);
      }

      expect(missing).toEqual([]);
    });

    /**
     * Per-dependent count test: exhaustively walk the registry, insert
     * one raw row per dependent collection (bypassing Mongoose
     * validation — we only care that the count filter sees the row),
     * and assert that (a) the per-label count is reflected in
     * `linkedCounts` and (b) the service routes through soft-archive.
     */
    it("counts and soft-archives for every registered dependent", async () => {
      const db = mongoose.connection.db;
      if (!db) throw new Error("Mongo connection has no db handle");

      for (const entry of CLIENT_ORG_DEPENDENT_MODELS) {
        await getHarness().reset();
        const tenantId = `t-${entry.model.modelName}`;
        const org = await ClientOrganizationModel.create({
          tenantId, gstin: GSTIN_A, companyName: "Org"
        });

        const collectionName = entry.model.collection.name;
        const baseDoc: Record<string, unknown> = {
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date()
        };
        if (entry.model.modelName === "TenantMailboxAssignment") {
          baseDoc.integrationId = new Types.ObjectId();
          baseDoc.assignedTo = "all";
          baseDoc.clientOrgIds = [org._id];
        } else {
          baseDoc.clientOrgId = org._id;
        }
        await db.collection(collectionName).insertOne(baseDoc);

        const result = await service.deleteOrArchive({
          tenantId, clientOrgId: org._id.toString()
        });
        expect(result.status).toBe("archived");
        const counts = result.linkedCounts as Record<string, number>;
        expect(counts[entry.label]).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
