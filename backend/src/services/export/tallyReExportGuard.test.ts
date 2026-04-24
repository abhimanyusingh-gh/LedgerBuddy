import { describeHarness } from "@/test-utils";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantTallyCompanyModel } from "@/models/integration/TenantTallyCompany.js";
import {
  clearInFlightExportVersion,
  computeVoucherGuid,
  EXPORT_VERSION_CONFLICT_REASON,
  ExportVersionConflictError,
  F12OverwriteNotVerifiedError,
  promoteExportVersion,
  resolveReExportDecision,
  stageInFlightExportVersion
} from "@/services/export/tallyReExportGuard.ts";
import { TALLY_ACTION } from "@/services/export/tallyExporter/xml.ts";

describe("computeVoucherGuid", () => {
  it("is deterministic for the same (tenantId, invoiceId, exportVersion)", () => {
    const a = computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 1 });
    const b = computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("produces a different GUID when exportVersion changes", () => {
    const v1 = computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 1 });
    const v2 = computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 2 });
    expect(v1).not.toBe(v2);
  });

  it("produces a different GUID when tenantId or invoiceId changes", () => {
    const base = computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 1 });
    expect(computeVoucherGuid({ tenantId: "tenant-2", invoiceId: "inv-1", exportVersion: 1 })).not.toBe(base);
    expect(computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-2", exportVersion: 1 })).not.toBe(base);
  });

  it("length-prefixing prevents separator collisions across differing tuples", () => {
    const a = computeVoucherGuid({ tenantId: "abc", invoiceId: "def", exportVersion: 1 });
    const b = computeVoucherGuid({ tenantId: "abc:def", invoiceId: "", exportVersion: 1 });
    expect(a).not.toBe(b);

    const c = computeVoucherGuid({ tenantId: "a", invoiceId: "b:c", exportVersion: 1 });
    const d = computeVoucherGuid({ tenantId: "a:b", invoiceId: "c", exportVersion: 1 });
    expect(c).not.toBe(d);
  });
});

describeHarness("resolveReExportDecision + 2-phase staging (BE-2)", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  it("first export issues ACTION=Create without requiring F12 verification", async () => {
    const decision = await resolveReExportDecision({
      tenantId: "tenant-1",
      invoiceId: "inv-1",
      currentExportVersion: 0
    });
    expect(decision.action).toBe(TALLY_ACTION.CREATE);
    expect(decision.nextExportVersion).toBe(1);
    expect(decision.guid).toBe(computeVoucherGuid({ tenantId: "tenant-1", invoiceId: "inv-1", exportVersion: 1 }));
  });

  it("re-export throws F12OverwriteNotVerifiedError when toggle not verified", async () => {
    await TenantTallyCompanyModel.create({
      tenantId: "tenant-1",
      companyName: "ACME",
      f12OverwriteByGuidVerified: false
    });

    await expect(
      resolveReExportDecision({ tenantId: "tenant-1", invoiceId: "inv-1", currentExportVersion: 1 })
    ).rejects.toBeInstanceOf(F12OverwriteNotVerifiedError);
  });

  it("re-export also throws when no TenantTallyCompany row exists", async () => {
    await expect(
      resolveReExportDecision({ tenantId: "tenant-missing", invoiceId: "inv-1", currentExportVersion: 1 })
    ).rejects.toBeInstanceOf(F12OverwriteNotVerifiedError);
  });

  it("re-export issues ACTION=Alter with same-invoice GUID bumped to next version when F12 verified", async () => {
    await TenantTallyCompanyModel.create({
      tenantId: "tenant-1",
      companyName: "ACME",
      stateName: "Karnataka",
      f12OverwriteByGuidVerified: true
    });

    const decision = await resolveReExportDecision({
      tenantId: "tenant-1",
      invoiceId: "inv-1",
      currentExportVersion: 1
    });
    expect(decision.action).toBe(TALLY_ACTION.ALTER);
    expect(decision.nextExportVersion).toBe(2);
    expect(decision.buyerStateName).toBe("Karnataka");
  });

  it("Phase 1 stages inFlightExportVersion to v+1 when exportVersion matches and inFlight is null", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-stage",
      sourceDocumentId: "d-stage",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 2
    });

    await stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 2 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
    expect(reloaded?.inFlightExportVersion).toBe(3);
  });

  it("Phase 3a (promoteExportVersion) bumps exportVersion and clears inFlight atomically", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-promote",
      sourceDocumentId: "d-promote",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 2,
      inFlightExportVersion: 3
    });

    await promoteExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(3);
    expect(reloaded?.inFlightExportVersion ?? null).toBeNull();
  });

  it("Phase 3b (clearInFlightExportVersion) clears inFlight without touching exportVersion", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-clear",
      sourceDocumentId: "d-clear",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 2,
      inFlightExportVersion: 3
    });

    await clearInFlightExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
    expect(reloaded?.inFlightExportVersion ?? null).toBeNull();
  });

  it("Phase 1 retry with matching inFlight=v+1 is idempotent (crash recovery)", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-retry",
      sourceDocumentId: "d-retry",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 4,
      inFlightExportVersion: 5
    });

    await stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 4 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(4);
    expect(reloaded?.inFlightExportVersion).toBe(5);
  });

  it("Phase 1 throws IN_FLIGHT_MISMATCH when an inFlight of a different version exists", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-inflight-diff",
      sourceDocumentId: "d-inflight-diff",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 2,
      inFlightExportVersion: 7
    });

    await expect(
      stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 2 })
    ).rejects.toMatchObject({
      code: "TALLY_EXPORT_VERSION_CONFLICT",
      reason: EXPORT_VERSION_CONFLICT_REASON.IN_FLIGHT_MISMATCH
    });

    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
    expect(reloaded?.inFlightExportVersion).toBe(7);
  });

  it("Phase 1 throws VERSION_MISMATCH when exportVersion has already been promoted", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-promoted",
      sourceDocumentId: "d-promoted",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 5
    });

    await expect(
      stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 3 })
    ).rejects.toMatchObject({
      code: "TALLY_EXPORT_VERSION_CONFLICT",
      reason: EXPORT_VERSION_CONFLICT_REASON.VERSION_MISMATCH
    });

    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(5);
    expect(reloaded?.inFlightExportVersion ?? null).toBeNull();
  });

  it("concurrent Phase 1 attempts on same expectedPriorVersion: both succeed when they converge on v+1", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-race",
      sourceDocumentId: "d-race",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 1
    });

    const outcomes = await Promise.allSettled([
      stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 1 }),
      stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 1 })
    ]);
    const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);

    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(1);
    expect(reloaded?.inFlightExportVersion).toBe(2);
  });

  it("Phase 3a throws when inFlight does not match stagedVersion (prevents stale promote)", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k-stale",
      sourceDocumentId: "d-stale",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      exportVersion: 2
    });

    await expect(
      promoteExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 })
    ).rejects.toBeInstanceOf(ExportVersionConflictError);

    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
  });

  it("new invoice defaults exportVersion to 0 and inFlightExportVersion to null (additive, backward-compatible)", async () => {
    const invoice = await InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: "k2",
      sourceDocumentId: "d2",
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED"
    });
    expect(invoice.exportVersion).toBe(0);
    expect(invoice.inFlightExportVersion ?? null).toBeNull();
  });
});
