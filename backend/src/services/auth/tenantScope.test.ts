import { Types } from "mongoose";
import { describeHarness } from "@/test-utils/mongoTestHarness.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import {
  findClientOrgIdsForTenant,
  findClientOrgIdByIdForTenant,
  findTenantIdsByClientOrgIds,
  validateClientOrgTenantInvariant,
  ClientOrgTenantInvariantError
} from "@/services/auth/tenantScope.js";

const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "29BCDEF2345G1Z6";
const GSTIN_OTHER = "29CDEFG3456H1Z7";

describeHarness("tenantScope helpers", () => {
  test("findClientOrgIdsForTenant returns only the tenant's client-orgs", async () => {
    const tenantA = new Types.ObjectId().toString();
    const tenantB = new Types.ObjectId().toString();

    const [orgA1, orgA2] = await Promise.all([
      ClientOrganizationModel.create({ tenantId: tenantA, gstin: GSTIN_A, companyName: "A1" }),
      ClientOrganizationModel.create({ tenantId: tenantA, gstin: GSTIN_B, companyName: "A2" })
    ]);
    await ClientOrganizationModel.create({ tenantId: tenantB, gstin: GSTIN_OTHER, companyName: "B1" });

    const idsA = await findClientOrgIdsForTenant(tenantA);
    const idsB = await findClientOrgIdsForTenant(tenantB);

    expect(idsA.map((i) => i.toString()).sort()).toEqual(
      [orgA1._id.toString(), orgA2._id.toString()].sort()
    );
    expect(idsB).toHaveLength(1);
    expect(idsA.map((i) => i.toString())).not.toContain(idsB[0].toString());
  });

  test("findClientOrgIdsForTenant returns [] for unknown tenant", async () => {
    const ids = await findClientOrgIdsForTenant(new Types.ObjectId().toString());
    expect(ids).toEqual([]);
  });

  test("findClientOrgIdByIdForTenant returns id when owned", async () => {
    const tenantId = new Types.ObjectId().toString();
    const org = await ClientOrganizationModel.create({
      tenantId,
      gstin: GSTIN_A,
      companyName: "Owned"
    });

    const result = await findClientOrgIdByIdForTenant(org._id.toString(), tenantId);
    expect(result?.toString()).toBe(org._id.toString());
  });

  test("findClientOrgIdByIdForTenant returns null when client-org belongs to another tenant", async () => {
    const tenantA = new Types.ObjectId().toString();
    const tenantB = new Types.ObjectId().toString();
    const orgA = await ClientOrganizationModel.create({
      tenantId: tenantA,
      gstin: GSTIN_A,
      companyName: "A"
    });

    const result = await findClientOrgIdByIdForTenant(orgA._id.toString(), tenantB);
    expect(result).toBeNull();
  });

  test("findTenantIdsByClientOrgIds returns clientOrgId -> tenantId map for a mixed-tenant set", async () => {
    const tenantA = new Types.ObjectId().toString();
    const tenantB = new Types.ObjectId().toString();
    const [orgA, orgB] = await Promise.all([
      ClientOrganizationModel.create({ tenantId: tenantA, gstin: GSTIN_A, companyName: "A" }),
      ClientOrganizationModel.create({ tenantId: tenantB, gstin: GSTIN_B, companyName: "B" })
    ]);

    const map = await findTenantIdsByClientOrgIds([orgA._id, orgB._id]);
    expect(map.size).toBe(2);
    expect(map.get(orgA._id.toString())).toBe(tenantA);
    expect(map.get(orgB._id.toString())).toBe(tenantB);
  });

  test("findTenantIdsByClientOrgIds returns empty map for empty input", async () => {
    const map = await findTenantIdsByClientOrgIds([]);
    expect(map.size).toBe(0);
  });
});

describeHarness("validateClientOrgTenantInvariant pre-save hook (Invoice)", () => {
  const baseInvoiceFields = {
    workloadTier: "standard",
    sourceType: "test-invariant",
    sourceKey: "invariant-src",
    mimeType: "application/pdf",
    receivedAt: new Date("2026-01-01T00:00:00Z")
  } as const;

  test("rejects save when clientOrgId belongs to another tenant", async () => {
    const tenantA = new Types.ObjectId().toString();
    const tenantB = new Types.ObjectId().toString();
    const orgB = await ClientOrganizationModel.create({
      tenantId: tenantB,
      gstin: GSTIN_A,
      companyName: "B-Corp"
    });

    const invoice = new InvoiceModel({
      ...baseInvoiceFields,
      tenantId: tenantA,
      clientOrgId: orgB._id,
      sourceDocumentId: "doc-mismatch",
      attachmentName: "mismatch.pdf",
      status: INVOICE_STATUS.PARSED
    });

    await expect(invoice.save()).rejects.toBeInstanceOf(
      ClientOrgTenantInvariantError
    );
  });

  test("allows save when status is PENDING_TRIAGE and clientOrgId is null", async () => {
    const tenantId = new Types.ObjectId().toString();

    const invoice = new InvoiceModel({
      ...baseInvoiceFields,
      tenantId,
      clientOrgId: null,
      sourceDocumentId: "doc-triage",
      attachmentName: "triage.pdf",
      status: INVOICE_STATUS.PENDING_TRIAGE
    });

    await expect(invoice.save()).resolves.toBeDefined();
  });

  test("allows save when tenantId matches the clientOrg's tenantId", async () => {
    const tenantId = new Types.ObjectId().toString();
    const org = await ClientOrganizationModel.create({
      tenantId,
      gstin: GSTIN_B,
      companyName: "Owned-Corp"
    });

    const invoice = new InvoiceModel({
      ...baseInvoiceFields,
      tenantId,
      clientOrgId: org._id,
      sourceDocumentId: "doc-happy",
      attachmentName: "happy.pdf",
      status: INVOICE_STATUS.PARSED
    });

    await expect(invoice.save()).resolves.toBeDefined();
  });

  test("REJECTED + null clientOrgId saves end-to-end (exemption applied at pre-save) (#179)", async () => {
    const tenantId = new Types.ObjectId().toString();
    const rejected = new InvoiceModel({
      ...baseInvoiceFields,
      tenantId,
      clientOrgId: null,
      sourceDocumentId: "doc-rejected-null",
      attachmentName: "rejected-null.pdf",
      status: INVOICE_STATUS.REJECTED
    });
    await expect(rejected.save()).resolves.toBeDefined();
  });

  test("REJECTED + a valid owned clientOrgId also saves (exemption permits null, does not forbid populated) (#179)", async () => {
    const tenantId = new Types.ObjectId().toString();
    const ownedOrg = await ClientOrganizationModel.create({
      tenantId,
      gstin: GSTIN_A,
      companyName: "Owned-Still-Rejectable"
    });
    const rejected = new InvoiceModel({
      ...baseInvoiceFields,
      tenantId,
      clientOrgId: ownedOrg._id,
      sourceDocumentId: "doc-rejected-owned",
      attachmentName: "rejected-owned.pdf",
      status: INVOICE_STATUS.REJECTED
    });
    await expect(rejected.save()).resolves.toBeDefined();
  });
});

describeHarness("validateClientOrgTenantInvariant exemption is scoped to PENDING_TRIAGE + REJECTED only (#179)", () => {
  test("permits null clientOrgId for PENDING_TRIAGE", async () => {
    const tenantId = new Types.ObjectId().toString();
    await expect(
      validateClientOrgTenantInvariant(tenantId, null, INVOICE_STATUS.PENDING_TRIAGE)
    ).resolves.toBeUndefined();
  });

  test("permits null clientOrgId for REJECTED", async () => {
    const tenantId = new Types.ObjectId().toString();
    await expect(
      validateClientOrgTenantInvariant(tenantId, null, INVOICE_STATUS.REJECTED)
    ).resolves.toBeUndefined();
  });

  test("rejects null clientOrgId for PARSED (exemption is correctly scoped to the set)", async () => {
    const tenantId = new Types.ObjectId().toString();
    await expect(
      validateClientOrgTenantInvariant(tenantId, null, INVOICE_STATUS.PARSED)
    ).rejects.toBeInstanceOf(ClientOrgTenantInvariantError);
  });

  test("rejects null clientOrgId for APPROVED (exemption is correctly scoped to the set)", async () => {
    const tenantId = new Types.ObjectId().toString();
    await expect(
      validateClientOrgTenantInvariant(tenantId, null, INVOICE_STATUS.APPROVED)
    ).rejects.toBeInstanceOf(ClientOrgTenantInvariantError);
  });
});
