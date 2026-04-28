import { Types } from "mongoose";
import { describeHarness } from "@/test-utils";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import {
  clearInFlightExportVersion,
  ClientOrganizationNotFoundError,
  computeVoucherGuid,
  EXPORT_VERSION_CONFLICT_REASON,
  ExportVersionConflictError,
  F12OverwriteNotVerifiedError,
  promoteExportVersion,
  resolveReExportDecision,
  stageInFlightExportVersion
} from "@/services/export/tallyReExportGuard.ts";
import { TALLY_ACTION } from "@/services/export/tallyExporter/xml.ts";

// Post hierarchy-pivot (#156/#158): voucher GUID is rooted on
// `clientOrgId` rather than `tenantId`. Tests use fixed hex strings for
// the non-harness GUID collision cases (no ObjectId format required —
// it's opaque input to SHA-256) and real ObjectIds for the harness
// persistence cases.
const CLIENT_ORG_1 = "000000000000000000000001";
const CLIENT_ORG_2 = "000000000000000000000002";

describe("computeVoucherGuid", () => {
  it("is deterministic for the same (clientOrgId, invoiceId, exportVersion)", () => {
    const a = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-1", exportVersion: 1 });
    const b = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-1", exportVersion: 1 });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("produces a different GUID when exportVersion changes", () => {
    const v1 = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-1", exportVersion: 1 });
    const v2 = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-1", exportVersion: 2 });
    expect(v1).not.toBe(v2);
  });

  it("produces a different GUID when clientOrgId or invoiceId changes", () => {
    const base = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-1", exportVersion: 1 });
    expect(
      computeVoucherGuid({ clientOrgId: CLIENT_ORG_2, invoiceId: "inv-1", exportVersion: 1 })
    ).not.toBe(base);
    expect(
      computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-2", exportVersion: 1 })
    ).not.toBe(base);
  });

  it("collision test: different client-orgs produce different GUIDs for same {invoice, version}", () => {
    // #158 acceptance criterion — locks the 1:1 mapping across client-orgs.
    const guidA = computeVoucherGuid({ clientOrgId: CLIENT_ORG_1, invoiceId: "inv-shared", exportVersion: 3 });
    const guidB = computeVoucherGuid({ clientOrgId: CLIENT_ORG_2, invoiceId: "inv-shared", exportVersion: 3 });
    expect(guidA).not.toBe(guidB);
  });

  it("length-prefixing prevents separator collisions across differing tuples", () => {
    const a = computeVoucherGuid({ clientOrgId: "abc", invoiceId: "def", exportVersion: 1 });
    const b = computeVoucherGuid({ clientOrgId: "abc:def", invoiceId: "", exportVersion: 1 });
    expect(a).not.toBe(b);

    const c = computeVoucherGuid({ clientOrgId: "a", invoiceId: "b:c", exportVersion: 1 });
    const d = computeVoucherGuid({ clientOrgId: "a:b", invoiceId: "c", exportVersion: 1 });
    expect(c).not.toBe(d);
  });
});

describeHarness("resolveReExportDecision + 2-phase staging (BE-2)", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
    gstinCounter = 0;
  });

  let gstinCounter = 0;
  async function persistClientOrg(overrides: {
    f12OverwriteByGuidVerified?: boolean;
    stateName?: string | null;
  } = {}): Promise<Types.ObjectId> {
    gstinCounter += 1;
    const n = gstinCounter;
    const first = String.fromCharCode("A".charCodeAt(0) + (n % 26));
    const second = String.fromCharCode("A".charCodeAt(0) + (Math.floor(n / 26) % 26));
    const doc = await ClientOrganizationModel.create({
      tenantId: "tenant-1",
      companyName: "ACME",
      stateName: overrides.stateName ?? null,
      gstin: `29${first}${second}CDE1234F1Z5`,
      f12OverwriteByGuidVerified: overrides.f12OverwriteByGuidVerified ?? false
    });
    return doc._id;
  }

  it("first export issues ACTION=Create without requiring F12 verification", async () => {
    const clientOrgId = await persistClientOrg({ f12OverwriteByGuidVerified: false });
    const decision = await resolveReExportDecision({
      clientOrgId: clientOrgId.toString(),
      invoiceId: "inv-1",
      currentExportVersion: 0
    });
    expect(decision.action).toBe(TALLY_ACTION.CREATE);
    expect(decision.nextExportVersion).toBe(1);
    expect(decision.guid).toBe(
      computeVoucherGuid({ clientOrgId: clientOrgId.toString(), invoiceId: "inv-1", exportVersion: 1 })
    );
  });

  it("re-export throws F12OverwriteNotVerifiedError when toggle not verified", async () => {
    const clientOrgId = await persistClientOrg({ f12OverwriteByGuidVerified: false });
    await expect(
      resolveReExportDecision({
        clientOrgId: clientOrgId.toString(),
        invoiceId: "inv-1",
        currentExportVersion: 1
      })
    ).rejects.toBeInstanceOf(F12OverwriteNotVerifiedError);
  });

  it("throws ClientOrganizationNotFoundError when the org row is missing on re-export", async () => {
    // Data-integrity violation: surfaces orphan invoice.clientOrgId references
    // (e.g. a delete that escaped FK checks) rather than silently no-op'ing
    // PLACEOFSUPPLY emission. Pre-supersedes the F12 check so the upstream
    // root cause is visible.
    await expect(
      resolveReExportDecision({
        clientOrgId: new Types.ObjectId().toString(),
        invoiceId: "inv-1",
        currentExportVersion: 1
      })
    ).rejects.toBeInstanceOf(ClientOrganizationNotFoundError);
  });

  it("throws ClientOrganizationNotFoundError on first export too (action=Create) when org row is missing", async () => {
    // Same data-integrity guard fires on the Create path — the F12 check is
    // skipped for Create, so without this throw a missing org would silently
    // produce a buyerStateName=null PLACEOFSUPPLY no-op.
    await expect(
      resolveReExportDecision({
        clientOrgId: new Types.ObjectId().toString(),
        invoiceId: "inv-create",
        currentExportVersion: 0
      })
    ).rejects.toBeInstanceOf(ClientOrganizationNotFoundError);
  });

  it("re-export issues ACTION=Alter with bumped version when F12 verified", async () => {
    const clientOrgId = await persistClientOrg({
      f12OverwriteByGuidVerified: true,
      stateName: "Karnataka"
    });
    const decision = await resolveReExportDecision({
      clientOrgId: clientOrgId.toString(),
      invoiceId: "inv-1",
      currentExportVersion: 1
    });
    expect(decision.action).toBe(TALLY_ACTION.ALTER);
    expect(decision.nextExportVersion).toBe(2);
    expect(decision.buyerStateName).toBe("Karnataka");
  });

  it("buyerStateName falls back to GSTIN-derived state when ClientOrganization.stateName is null", async () => {
    // Post-pivot: ClientOrganization.gstin is required + format-validated, so the
    // GSTIN-derived buyer state almost always succeeds when stateName is unset.
    // persistClientOrg uses GSTIN prefix "29" → Karnataka.
    const clientOrgId = await persistClientOrg({
      f12OverwriteByGuidVerified: true,
      stateName: null
    });
    const decision = await resolveReExportDecision({
      clientOrgId: clientOrgId.toString(),
      invoiceId: "inv-fallback",
      currentExportVersion: 1
    });
    expect(decision.buyerStateName).toBe("Karnataka");
  });

  it("forceAlter=true upgrades currentExportVersion=0 → ACTION=Alter and still requires F12 verified (#277)", async () => {
    const clientOrgId = await persistClientOrg({ f12OverwriteByGuidVerified: true, stateName: "Karnataka" });
    const decision = await resolveReExportDecision({
      clientOrgId: clientOrgId.toString(),
      invoiceId: "inv-retry",
      currentExportVersion: 0,
      forceAlter: true
    });
    expect(decision.action).toBe(TALLY_ACTION.ALTER);
    expect(decision.nextExportVersion).toBe(1);
  });

  it("forceAlter=true on unverified F12 throws F12OverwriteNotVerifiedError (#277)", async () => {
    const clientOrgId = await persistClientOrg({ f12OverwriteByGuidVerified: false });
    await expect(
      resolveReExportDecision({
        clientOrgId: clientOrgId.toString(),
        invoiceId: "inv-retry-2",
        currentExportVersion: 0,
        forceAlter: true
      })
    ).rejects.toBeInstanceOf(F12OverwriteNotVerifiedError);
  });

  it("buyerStateName prefers explicit ClientOrganization.stateName over GSTIN-derived", async () => {
    // GSTIN prefix 29 (Karnataka) but stateName explicitly set to Tamil Nadu —
    // explicit value wins.
    const clientOrgId = await persistClientOrg({
      f12OverwriteByGuidVerified: true,
      stateName: "Tamil Nadu"
    });
    const decision = await resolveReExportDecision({
      clientOrgId: clientOrgId.toString(),
      invoiceId: "inv-prec",
      currentExportVersion: 1
    });
    expect(decision.buyerStateName).toBe("Tamil Nadu");
  });

  async function createInvoice(overrides: Record<string, unknown>) {
    const { clientOrgId: overrideClientOrgId, ...rest } = overrides;
    const clientOrgId = overrideClientOrgId
      ? (overrideClientOrgId as Types.ObjectId)
      : await persistClientOrg();
    return InvoiceModel.create({
      tenantId: "tenant-1",
      sourceType: "manual",
      sourceKey: `k-${Math.random().toString(36).slice(2)}`,
      sourceDocumentId: `d-${Math.random().toString(36).slice(2)}`,
      attachmentName: "a.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      status: "PARSED",
      ...rest,
      clientOrgId
    });
  }

  it("Phase 1 stages inFlightExportVersion to v+1 when exportVersion matches and inFlight is null", async () => {
    const invoice = await createInvoice({ exportVersion: 2 });
    await stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 2 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
    expect(reloaded?.inFlightExportVersion).toBe(3);
  });

  it("Phase 3a (promoteExportVersion) bumps exportVersion and clears inFlight atomically", async () => {
    const invoice = await createInvoice({ exportVersion: 2, inFlightExportVersion: 3 });
    await promoteExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(3);
    expect(reloaded?.inFlightExportVersion ?? null).toBeNull();
  });

  it("Phase 3b (clearInFlightExportVersion) clears inFlight without touching exportVersion", async () => {
    const invoice = await createInvoice({ exportVersion: 2, inFlightExportVersion: 3 });
    await clearInFlightExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
    expect(reloaded?.inFlightExportVersion ?? null).toBeNull();
  });

  it("Phase 1 retry with matching inFlight=v+1 is idempotent (crash recovery)", async () => {
    const invoice = await createInvoice({ exportVersion: 4, inFlightExportVersion: 5 });
    await stageInFlightExportVersion({ invoiceId: String(invoice._id), expectedPriorVersion: 4 });
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(4);
    expect(reloaded?.inFlightExportVersion).toBe(5);
  });

  it("Phase 1 throws IN_FLIGHT_MISMATCH when an inFlight of a different version exists", async () => {
    const invoice = await createInvoice({ exportVersion: 2, inFlightExportVersion: 7 });
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
    const invoice = await createInvoice({ exportVersion: 5 });
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

  it("concurrent Phase 1 attempts on same expectedPriorVersion converge on v+1", async () => {
    const invoice = await createInvoice({ exportVersion: 1 });
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
    const invoice = await createInvoice({ exportVersion: 2 });
    await expect(
      promoteExportVersion({ invoiceId: String(invoice._id), stagedVersion: 3 })
    ).rejects.toBeInstanceOf(ExportVersionConflictError);
    const reloaded = await InvoiceModel.findById(invoice._id).lean();
    expect(reloaded?.exportVersion).toBe(2);
  });

  it("new invoice defaults exportVersion to 0 and inFlightExportVersion to null", async () => {
    const invoice = await createInvoice({});
    expect(invoice.exportVersion).toBe(0);
    expect(invoice.inFlightExportVersion ?? null).toBeNull();
  });
});
