import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import mongoose, { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { TenantMailboxAssignmentModel } from "@/models/integration/TenantMailboxAssignment.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping.js";
import { ClientOrgsAdminService } from "@/services/tenant/clientOrgsAdminService.js";
import {
  CLIENT_ORG_DEPENDENT_MODELS,
  NON_REQUIRED_REGISTERED_MODELS
} from "@/services/tenant/clientOrgDependents.js";
import { INVOICE_STATUS } from "@/types/invoice.js";

const MODELS_ROOT = join(__dirname, "..", "..", "models");
const TEST_FILE_SUFFIXES = [".test.ts", ".test.js"] as const;
const INDEX_FILES = ["index.ts", "index.js"] as const;

function listModelFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listModelFiles(full));
      continue;
    }
    if (!entry.endsWith(".ts") && !entry.endsWith(".js")) continue;
    if (TEST_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
    if (INDEX_FILES.includes(entry as (typeof INDEX_FILES)[number])) continue;
    out.push(full);
  }
  return out;
}

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

    it("soft-archives when per-org TdsSectionMapping overrides exist (global defaults are not counted)", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await TdsSectionMappingModel.create({
        tenantId: null,
        clientOrgId: null,
        glCategory: "Professional",
        panCategory: "I",
        tdsSection: "194J",
        priority: 0
      });
      await TdsSectionMappingModel.create({
        tenantId: TENANT_A,
        clientOrgId: a._id,
        glCategory: "Professional",
        panCategory: "I",
        tdsSection: "194J",
        priority: 10
      });
      await TdsSectionMappingModel.create({
        tenantId: TENANT_A,
        clientOrgId: a._id,
        glCategory: "Rent",
        panCategory: "I",
        tdsSection: "194I",
        priority: 10
      });

      const result = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(result.status).toBe("archived");
      expect(result.linkedCounts.tdsSectionMappings).toBe(2);

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

  describe("previewArchive (#206)", () => {
    it("404s for cross-tenant id (matches deleteOrArchive semantics)", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await expect(
        service.previewArchive({ tenantId: TENANT_B, clientOrgId: a._id.toString() })
      ).rejects.toMatchObject({ statusCode: 404, code: "client_org_not_found" });
    });

    it("does not mutate state — re-running yields identical responses and never sets archivedAt", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: a._id, sourceType: "upload", sourceKey: "k", sourceDocumentId: "d",
        attachmentName: "x.pdf", mimeType: "application/pdf", receivedAt: new Date(),
        status: INVOICE_STATUS.NEEDS_REVIEW
      });

      const first = await service.previewArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      const second = await service.previewArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(first).toEqual(second);
      expect(first.projectedStatus).toBe("archived");
      expect(first.archivedAt).toBeNull();

      const reread = await ClientOrganizationModel.findById(a._id).lean();
      expect(reread?.archivedAt ?? null).toBeNull();
    });

    it("parity: preview counts === post-archive counts on the same fixture (with dependents)", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: a._id, sourceType: "upload", sourceKey: "k", sourceDocumentId: "d",
        attachmentName: "x.pdf", mimeType: "application/pdf", receivedAt: new Date(),
        status: INVOICE_STATUS.NEEDS_REVIEW
      });
      await TenantMailboxAssignmentModel.create({
        tenantId: TENANT_A,
        integrationId: new Types.ObjectId(),
        assignedTo: "all",
        clientOrgIds: [a._id]
      });

      const preview = await service.previewArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(preview.projectedStatus).toBe("archived");

      const archived = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(archived.status).toBe("archived");

      expect(preview.linkedCounts).toEqual(archived.linkedCounts);
    });

    it("parity: empty fixture projects 'deleted' and matches the destructive path", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });

      const preview = await service.previewArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(preview.projectedStatus).toBe("deleted");

      const deleted = await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(deleted.status).toBe("deleted");
      expect(preview.linkedCounts).toEqual(deleted.linkedCounts);
    });

    it("returns the existing archivedAt timestamp for an already-archived org without advancing it", async () => {
      const a = await ClientOrganizationModel.create({ tenantId: TENANT_A, gstin: GSTIN_A, companyName: "ACME" });
      await InvoiceModel.create({
        tenantId: TENANT_A, clientOrgId: a._id, sourceType: "upload", sourceKey: "k", sourceDocumentId: "d",
        attachmentName: "x.pdf", mimeType: "application/pdf", receivedAt: new Date(),
        status: INVOICE_STATUS.NEEDS_REVIEW
      });
      await service.deleteOrArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      const archivedAtBefore = (await ClientOrganizationModel.findById(a._id).lean())?.archivedAt;
      expect(archivedAtBefore).toBeInstanceOf(Date);

      await new Promise((r) => setTimeout(r, 5));

      const preview = await service.previewArchive({ tenantId: TENANT_A, clientOrgId: a._id.toString() });
      expect(preview.projectedStatus).toBe("archived");
      expect(preview.archivedAt).toBeInstanceOf(Date);
      expect((preview.archivedAt as Date).getTime()).toBe(archivedAtBefore?.getTime());

      const archivedAtAfter = (await ClientOrganizationModel.findById(a._id).lean())?.archivedAt;
      expect(archivedAtAfter?.getTime()).toBe(archivedAtBefore?.getTime());
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
     * Robustness: rather than relying on the registry transitively
     * importing every dependent model file at module-load (which
     * silently breaks when a contributor adds a new model and forgets
     * to register it AND no other test imports it), we walk
     * `backend/src/models/**` ourselves and dynamically import every
     * model file before introspecting `mongoose.modelNames()`.
     */
    beforeAll(async () => {
      const files = listModelFiles(MODELS_ROOT);
      await Promise.all(
        files.map(async (file) => {
          try {
            await import(file);
          } catch (error) {
            throw new Error(
              `Failed to dynamic-import model file ${file} for drift detection: ${(error as Error).message}`
            );
          }
        })
      );
    });

    it("registers every required clientOrgId/clientOrgIds model loaded in mongoose", () => {
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
        if (!registeredNames.has(name)) {
          missing.push(
            `Model "${name}" has required clientOrgId but is missing from CLIENT_ORG_DEPENDENT_MODELS — add it to backend/src/services/tenant/clientOrgDependents.ts`
          );
        }
      }

      expect(missing).toEqual([]);
    });

    /**
     * Guard the non-required allowlist: each model named in
     * `NON_REQUIRED_REGISTERED_MODELS` must (a) actually be registered
     * with Mongoose and (b) have a non-required `clientOrgId` /
     * `clientOrgIds` path. If a contributor flips the schema to
     * `required: true`, this test fires and the non-required entry
     * should either be removed from the allowlist (now covered by the
     * required-path drift assertion above) or reverted.
     */
    it("non-required allowlist entries stay non-required in their schemas", () => {
      for (const name of NON_REQUIRED_REGISTERED_MODELS) {
        expect(mongoose.modelNames()).toContain(name);
        const schema = mongoose.model(name).schema;
        const singlePath = schema.path("clientOrgId");
        const arrayPath = schema.path("clientOrgIds");
        const singleRequired =
          !!singlePath && Boolean((singlePath as unknown as { isRequired?: boolean }).isRequired);
        const arrayRequired =
          !!arrayPath && Boolean((arrayPath as unknown as { isRequired?: boolean }).isRequired);
        expect({ name, singleRequired, arrayRequired }).toEqual({
          name,
          singleRequired: false,
          arrayRequired: false
        });
      }
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
