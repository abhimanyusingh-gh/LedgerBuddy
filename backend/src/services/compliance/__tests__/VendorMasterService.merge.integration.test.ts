import mongoose from "mongoose";
import { describeHarness } from "@/test-utils";
import { VendorMasterService } from "@/services/compliance/VendorMasterService";
import { VendorMasterModel } from "@/models/compliance/VendorMaster";
import { TdsVendorLedgerModel } from "@/models/compliance/TdsVendorLedger";
import { InvoiceModel } from "@/models/invoice/Invoice";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization";
import { AuditLogModel } from "@/models/core/AuditLog";
import { AuditLogService } from "@/services/core/AuditLogService";
import { VENDOR_STATUS, VENDOR_AUDIT_ACTION } from "@/types/vendor";
import { toUUID, type UUID } from "@/types/uuid";

const TENANT_ID = toUUID("tenant-merge-262");

interface SeedResult {
  clientOrgId: mongoose.Types.ObjectId;
  targetId: string;
  sourceId: string;
  targetFingerprint: string;
  sourceFingerprint: string;
}

describeHarness("VendorMasterService.mergeVendors integration (atomicity)", ({ getHarness }) => {
  let service: VendorMasterService;
  let auditLogService: AuditLogService;

  beforeAll(async () => {
    await VendorMasterModel.syncIndexes();
    await TdsVendorLedgerModel.syncIndexes();
    await InvoiceModel.syncIndexes();
  });

  beforeEach(() => {
    service = new VendorMasterService();
    auditLogService = new AuditLogService();
  });

  afterEach(async () => {
    await getHarness().reset();
  });

  async function seedTwoVendors(): Promise<SeedResult> {
    const org = await ClientOrganizationModel.create({
      tenantId: TENANT_ID,
      companyName: "MergeCo",
      gstin: "29ABCDE1234F1Z5"
    });

    const target = await VendorMasterModel.create({
      tenantId: TENANT_ID,
      clientOrgId: org._id,
      vendorFingerprint: "vf-target",
      name: "Acme (Canonical)",
      lastInvoiceDate: new Date("2026-01-01"),
      vendorStatus: VENDOR_STATUS.ACTIVE
    });

    const source = await VendorMasterModel.create({
      tenantId: TENANT_ID,
      clientOrgId: org._id,
      vendorFingerprint: "vf-source",
      name: "Acme Industries Ltd",
      lastInvoiceDate: new Date("2026-02-15"),
      vendorStatus: VENDOR_STATUS.ACTIVE
    });

    return {
      clientOrgId: org._id,
      targetId: String(target._id),
      sourceId: String(source._id),
      targetFingerprint: "vf-target",
      sourceFingerprint: "vf-source"
    };
  }

  function actor(): { userId: UUID; userEmail: string } {
    return { userId: toUUID("user-merge-1"), userEmail: "admin@example.com" };
  }

  it("consolidates TdsVendorLedger rows: same (fy, section) sums cumulative values", async () => {
    const seed = await seedTwoVendors();

    await TdsVendorLedgerModel.create({
      tenantId: TENANT_ID,
      vendorFingerprint: seed.targetFingerprint,
      financialYear: "2025-26",
      section: "194C",
      cumulativeBaseMinor: 50000,
      cumulativeTdsMinor: 500,
      invoiceCount: 2,
      thresholdCrossedAt: new Date("2026-02-01"),
      entries: []
    });

    await TdsVendorLedgerModel.create({
      tenantId: TENANT_ID,
      vendorFingerprint: seed.sourceFingerprint,
      financialYear: "2025-26",
      section: "194C",
      cumulativeBaseMinor: 30000,
      cumulativeTdsMinor: 300,
      invoiceCount: 1,
      thresholdCrossedAt: new Date("2026-01-15"),
      entries: []
    });

    await service.mergeVendors(
      {
        scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
        targetVendorId: seed.targetId,
        sourceVendorId: seed.sourceId,
        actor: actor()
      },
      auditLogService
    );

    const ledgers = await TdsVendorLedgerModel.find({ tenantId: TENANT_ID, financialYear: "2025-26", section: "194C" }).lean();
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].vendorFingerprint).toBe(seed.targetFingerprint);
    expect(ledgers[0].cumulativeBaseMinor).toBe(80000);
    expect(ledgers[0].cumulativeTdsMinor).toBe(800);
    expect(ledgers[0].invoiceCount).toBe(3);
    expect(ledgers[0].thresholdCrossedAt?.toISOString()).toBe(new Date("2026-01-15").toISOString());
  });

  it("repoints source-only ledger rows to the target fingerprint", async () => {
    const seed = await seedTwoVendors();

    await TdsVendorLedgerModel.create({
      tenantId: TENANT_ID,
      vendorFingerprint: seed.sourceFingerprint,
      financialYear: "2025-26",
      section: "194J",
      cumulativeBaseMinor: 20000,
      cumulativeTdsMinor: 2000,
      invoiceCount: 1,
      entries: []
    });

    await service.mergeVendors(
      {
        scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
        targetVendorId: seed.targetId,
        sourceVendorId: seed.sourceId,
        actor: actor()
      },
      auditLogService
    );

    const remaining = await TdsVendorLedgerModel.find({ tenantId: TENANT_ID, vendorFingerprint: seed.sourceFingerprint }).lean();
    expect(remaining).toHaveLength(0);

    const repointed = await TdsVendorLedgerModel.find({ tenantId: TENANT_ID, vendorFingerprint: seed.targetFingerprint, section: "194J" }).lean();
    expect(repointed).toHaveLength(1);
  });

  it("repoints invoice metadata.vendorFingerprint from source to target", async () => {
    const seed = await seedTwoVendors();

    await InvoiceModel.collection.insertMany([
      {
        tenantId: TENANT_ID,
        clientOrgId: seed.clientOrgId,
        sourceType: "EMAIL",
        sourceKey: "src-1",
        sourceDocumentId: "doc-1",
        attachmentName: "inv-1.pdf",
        status: "EXTRACTED",
        metadata: { vendorFingerprint: seed.sourceFingerprint },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        tenantId: TENANT_ID,
        clientOrgId: seed.clientOrgId,
        sourceType: "EMAIL",
        sourceKey: "src-2",
        sourceDocumentId: "doc-2",
        attachmentName: "inv-2.pdf",
        status: "EXTRACTED",
        metadata: { vendorFingerprint: seed.targetFingerprint },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);

    await service.mergeVendors(
      {
        scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
        targetVendorId: seed.targetId,
        sourceVendorId: seed.sourceId,
        actor: actor()
      },
      auditLogService
    );

    const sourceCount = await InvoiceModel.countDocuments({
      tenantId: TENANT_ID,
      "metadata.vendorFingerprint": seed.sourceFingerprint
    });
    const targetCount = await InvoiceModel.countDocuments({
      tenantId: TENANT_ID,
      "metadata.vendorFingerprint": seed.targetFingerprint
    });
    expect(sourceCount).toBe(0);
    expect(targetCount).toBe(2);
  });

  it("marks the source vendor with vendorStatus=merged (audit marker, not deletion)", async () => {
    const seed = await seedTwoVendors();

    await service.mergeVendors(
      {
        scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
        targetVendorId: seed.targetId,
        sourceVendorId: seed.sourceId,
        actor: actor()
      },
      auditLogService
    );

    const source = await VendorMasterModel.findById(seed.sourceId).lean();
    expect(source).not.toBeNull();
    expect(source!.vendorStatus).toBe(VENDOR_STATUS.MERGED);

    const target = await VendorMasterModel.findById(seed.targetId).lean();
    expect(target!.vendorStatus).toBe(VENDOR_STATUS.ACTIVE);
  });

  it("emits a vendor_merged audit log entry with previousValue + newValue snapshots", async () => {
    const seed = await seedTwoVendors();

    await service.mergeVendors(
      {
        scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
        targetVendorId: seed.targetId,
        sourceVendorId: seed.sourceId,
        actor: actor()
      },
      auditLogService
    );

    const audit = await AuditLogModel.findOne({ tenantId: TENANT_ID, action: VENDOR_AUDIT_ACTION.MERGED }).lean();
    expect(audit).not.toBeNull();
    expect(audit!.entityId).toBe(seed.targetId);
    const prev = audit!.previousValue as { source?: unknown; target?: unknown };
    expect(prev.source).toBeTruthy();
    expect(prev.target).toBeTruthy();
  });

  it("rolls back all changes when the transaction throws mid-merge (atomicity)", async () => {
    const seed = await seedTwoVendors();

    await TdsVendorLedgerModel.create({
      tenantId: TENANT_ID,
      vendorFingerprint: seed.sourceFingerprint,
      financialYear: "2025-26",
      section: "194C",
      cumulativeBaseMinor: 30000,
      cumulativeTdsMinor: 300,
      invoiceCount: 1,
      entries: []
    });

    const failingAuditLog = {
      record: jest.fn().mockResolvedValue(undefined)
    } as unknown as AuditLogService;

    const originalSave = VendorMasterModel.prototype.save;
    const saveSpy = jest.spyOn(VendorMasterModel.prototype, "save").mockImplementationOnce(async function (this: mongoose.Document) {
      throw new Error("simulated mid-merge failure");
    });

    try {
      await expect(
        service.mergeVendors(
          {
            scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
            targetVendorId: seed.targetId,
            sourceVendorId: seed.sourceId,
            actor: actor()
          },
          failingAuditLog
        )
      ).rejects.toThrow();
    } finally {
      saveSpy.mockRestore();
      VendorMasterModel.prototype.save = originalSave;
    }

    const sourceLedger = await TdsVendorLedgerModel.findOne({
      tenantId: TENANT_ID,
      vendorFingerprint: seed.sourceFingerprint
    }).lean();
    expect(sourceLedger).not.toBeNull();

    const source = await VendorMasterModel.findById(seed.sourceId).lean();
    expect(source!.vendorStatus).toBe(VENDOR_STATUS.ACTIVE);

    expect(failingAuditLog.record).not.toHaveBeenCalled();
  });

  it("rejects merging an already-merged source", async () => {
    const seed = await seedTwoVendors();

    await VendorMasterModel.findByIdAndUpdate(seed.sourceId, { vendorStatus: VENDOR_STATUS.MERGED });

    await expect(
      service.mergeVendors(
        {
          scope: { tenantId: TENANT_ID, clientOrgId: seed.clientOrgId },
          targetVendorId: seed.targetId,
          sourceVendorId: seed.sourceId,
          actor: actor()
        },
        auditLogService
      )
    ).rejects.toThrow(/already merged/);
  });
});
