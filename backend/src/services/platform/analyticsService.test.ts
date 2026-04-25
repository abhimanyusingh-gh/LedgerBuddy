import { Types } from "mongoose";
import { describeHarness } from "@/test-utils/mongoTestHarness.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { getOverview } from "@/services/platform/analyticsService.js";

const GSTIN_A = "29ABCDE1234F1Z5";
const GSTIN_B = "29BCDEF2345G1Z6";

const baseInvoiceFields = {
  workloadTier: "standard",
  sourceType: "test-analytics",
  sourceKey: "analytics-src",
  mimeType: "application/pdf"
} as const;

async function seedApprovedInvoice(args: {
  tenantId: string;
  clientOrgId: Types.ObjectId;
  amountMinor: number;
  approvedAt: Date;
  createdAt: Date;
  vendorName: string;
}) {
  const inv = new InvoiceModel({
    ...baseInvoiceFields,
    tenantId: args.tenantId,
    clientOrgId: args.clientOrgId,
    sourceDocumentId: `doc-${new Types.ObjectId().toHexString()}`,
    attachmentName: `${args.vendorName}.pdf`,
    receivedAt: args.createdAt,
    status: INVOICE_STATUS.APPROVED,
    parsed: { vendorName: args.vendorName, totalAmountMinor: args.amountMinor },
    approval: { approvedAt: args.approvedAt }
  });
  inv.set("createdAt", args.createdAt);
  await inv.save();
  return inv;
}

describeHarness("analyticsService getOverview — optional clientOrgId (#162)", () => {
  test("aggregates across all client-orgs of the tenant when clientOrgId is omitted", async () => {
    const tenantId = new Types.ObjectId().toString();
    const otherTenantId = new Types.ObjectId().toString();

    const orgA = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_A, companyName: "A" });
    const orgB = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_B, companyName: "B" });
    const orgOther = await ClientOrganizationModel.create({
      tenantId: otherTenantId,
      gstin: "29OTHER1234F1Z5",
      companyName: "Other"
    });

    const approvedAt = new Date("2026-04-10T12:00:00Z");
    const createdAt = new Date("2026-04-10T10:00:00Z");

    await seedApprovedInvoice({ tenantId, clientOrgId: orgA._id, amountMinor: 10000, approvedAt, createdAt, vendorName: "VendorA" });
    await seedApprovedInvoice({ tenantId, clientOrgId: orgB._id, amountMinor: 25000, approvedAt, createdAt, vendorName: "VendorB" });
    await seedApprovedInvoice({
      tenantId: otherTenantId,
      clientOrgId: orgOther._id,
      amountMinor: 99999,
      approvedAt,
      createdAt,
      vendorName: "VendorOther"
    });

    const overview = await getOverview(tenantId, new Date("2026-04-01T00:00:00Z"), new Date("2026-04-30T23:59:59Z"));

    expect(overview.kpis.totalInvoices).toBe(2);
    expect(overview.kpis.approvedAmountMinor).toBe(35000);
    expect(overview.topVendorsByApproved.map((v) => v.vendor).sort()).toEqual(["VendorA", "VendorB"]);
  });

  test("scopes to a single client-org when clientOrgId is provided", async () => {
    const tenantId = new Types.ObjectId().toString();

    const orgA = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_A, companyName: "A" });
    const orgB = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_B, companyName: "B" });

    const approvedAt = new Date("2026-04-10T12:00:00Z");
    const createdAt = new Date("2026-04-10T10:00:00Z");

    await seedApprovedInvoice({ tenantId, clientOrgId: orgA._id, amountMinor: 10000, approvedAt, createdAt, vendorName: "VendorA" });
    await seedApprovedInvoice({ tenantId, clientOrgId: orgB._id, amountMinor: 25000, approvedAt, createdAt, vendorName: "VendorB" });

    const overviewA = await getOverview(
      tenantId,
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-30T23:59:59Z"),
      { clientOrgId: orgA._id }
    );

    expect(overviewA.kpis.totalInvoices).toBe(1);
    expect(overviewA.kpis.approvedAmountMinor).toBe(10000);
    expect(overviewA.topVendorsByApproved.map((v) => v.vendor)).toEqual(["VendorA"]);
  });

  test("clientOrgId=null is treated identically to omission (aggregate)", async () => {
    const tenantId = new Types.ObjectId().toString();
    const orgA = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_A, companyName: "A" });
    const orgB = await ClientOrganizationModel.create({ tenantId, gstin: GSTIN_B, companyName: "B" });

    const approvedAt = new Date("2026-04-10T12:00:00Z");
    const createdAt = new Date("2026-04-10T10:00:00Z");

    await seedApprovedInvoice({ tenantId, clientOrgId: orgA._id, amountMinor: 7000, approvedAt, createdAt, vendorName: "VendorA" });
    await seedApprovedInvoice({ tenantId, clientOrgId: orgB._id, amountMinor: 13000, approvedAt, createdAt, vendorName: "VendorB" });

    const overview = await getOverview(
      tenantId,
      new Date("2026-04-01T00:00:00Z"),
      new Date("2026-04-30T23:59:59Z"),
      { clientOrgId: null }
    );

    expect(overview.kpis.totalInvoices).toBe(2);
    expect(overview.kpis.approvedAmountMinor).toBe(20000);
  });
});
