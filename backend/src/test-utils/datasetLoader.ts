
import { TenantModel } from "@/models/core/Tenant.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";
import { buildFixtures, FIXTURE_NOW } from "./fixtures.js";

interface DatasetScale {
  tenants: number;
  vendorsPerTenant: number;
  invoicesPerVendor: number;
  seed?: number;
}

interface DatasetLoadResult {
  tenantCount: number;
  vendorCount: number;
  invoiceCount: number;
  elapsedMs: number;
}

export async function generateDataset(
  scale: DatasetScale
): Promise<DatasetLoadResult> {
  const start = Date.now();
  const { tenants, clientOrgs, vendors, invoices } = await buildFixtures({
    ...scale,
    persist: false
  });

  await TenantModel.insertMany(
    tenants.map((t) => ({
      _id: t._id,
      name: t.name,
      onboardingStatus: ONBOARDING_STATUS.COMPLETED,
      country: "IN",
      defaultCurrency: "INR",
      mode: TENANT_MODE.TEST,
      enabled: true
    })),
    { ordered: false }
  );

  await ClientOrganizationModel.insertMany(
    clientOrgs.map((c) => ({
      _id: c._id,
      tenantId: c.tenantId,
      gstin: c.gstin,
      companyName: `ClientOrg ${c._id.toHexString().slice(-6)}`
    })),
    { ordered: false }
  );

  const tenantByClientOrgId = new Map<string, string>();
  for (const c of clientOrgs) {
    tenantByClientOrgId.set(c._id.toHexString(), c.tenantId);
  }

  await insertInBatches(VendorMasterModel, vendors, (v, i) => ({
    _id: v._id,
    tenantId: tenantByClientOrgId.get(v.clientOrgId.toHexString()) ?? "",
    clientOrgId: v.clientOrgId,
    vendorFingerprint: `vendor-bulk-${i}`,
    name: v.name,
    gstin: v.gstin,
    pan: v.pan,
    invoiceCount: scale.invoicesPerVendor,
    lastInvoiceDate: FIXTURE_NOW
  }));

  await insertInBatches(InvoiceModel, invoices, (inv, i) => ({
    _id: inv._id,
    tenantId: tenantByClientOrgId.get(inv.clientOrgId.toHexString()) ?? "",
    clientOrgId: inv.clientOrgId,
    workloadTier: "standard",
    sourceType: "harness-bulk",
    sourceKey: `harness-bulk-${scale.seed ?? 42}`,
    sourceDocumentId: `doc-${i}`,
    attachmentName: `${inv.invoiceNumber}.pdf`,
    mimeType: "application/pdf",
    receivedAt: FIXTURE_NOW,
    status: INVOICE_STATUS.PARSED,
    parsed: {
      invoiceNumber: inv.invoiceNumber,
      vendorName: inv.vendorName,
      invoiceDate: FIXTURE_NOW,
      totalAmountMinor: inv.totalAmountMinor,
      currency: "INR"
    }
  }));

  return {
    tenantCount: tenants.length,
    vendorCount: vendors.length,
    invoiceCount: invoices.length,
    elapsedMs: Date.now() - start
  };
}

async function insertInBatches<TDoc, TOut>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: { insertMany: (docs: TOut[], opts?: { ordered?: boolean }) => Promise<unknown> },
  items: TDoc[],
  map: (item: TDoc, index: number) => TOut,
  batchSize = 500
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize).map((item, k) => map(item, i + k));
    await model.insertMany(chunk, { ordered: false });
  }
}
