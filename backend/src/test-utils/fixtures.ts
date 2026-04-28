
import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { TenantModel } from "@/models/core/Tenant.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { ClientOrganizationModel } from "@/models/integration/ClientOrganization.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";

export const FIXTURE_NOW = new Date("2026-04-23T00:00:00.000Z");

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function pickInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function deterministicObjectId(key: string): Types.ObjectId {
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 24);
  return new Types.ObjectId(hex);
}

interface FixtureTenant {
  _id: Types.ObjectId;
  name: string;
}

interface FixtureClientOrg {
  _id: Types.ObjectId;
  tenantId: string;
  gstin: string;
}

interface FixtureVendor {
  _id: Types.ObjectId;
  clientOrgId: Types.ObjectId;
  name: string;
  gstin: string | null;
  pan: string | null;
}

interface FixtureInvoice {
  _id: Types.ObjectId;
  clientOrgId: Types.ObjectId;
  vendorName: string;
  totalAmountMinor: number;
  invoiceNumber: string;
}

interface FixtureOptions {
  tenants?: number;
  vendorsPerTenant?: number;
  invoicesPerVendor?: number;
  seed?: number;
  persist?: boolean;
}

interface FixtureSet {
  tenants: FixtureTenant[];
  clientOrgs: FixtureClientOrg[];
  vendors: FixtureVendor[];
  invoices: FixtureInvoice[];
}

export async function buildFixtures(
  options: FixtureOptions = {}
): Promise<FixtureSet> {
  const {
    tenants: tenantCount = 1,
    vendorsPerTenant = 3,
    invoicesPerVendor = 5,
    seed = 42,
    persist = false
  } = options;

  const rng = makeRng(seed);
  const tenants: FixtureTenant[] = [];
  const clientOrgs: FixtureClientOrg[] = [];
  const vendors: FixtureVendor[] = [];
  const invoices: FixtureInvoice[] = [];

  for (let t = 0; t < tenantCount; t++) {
    const tenant: FixtureTenant = {
      _id: deterministicObjectId(`tenant:${t}`),
      name: `Test Tenant ${t}`
    };
    tenants.push(tenant);

    if (persist) {
      await TenantModel.create({
        _id: tenant._id,
        name: tenant.name,
        onboardingStatus: ONBOARDING_STATUS.COMPLETED,
        country: "IN",
        defaultCurrency: "INR",
        mode: TENANT_MODE.TEST,
        enabled: true
      });
    }

    const clientOrg: FixtureClientOrg = {
      _id: deterministicObjectId(`clientOrg:${t}`),
      tenantId: String(tenant._id),
      gstin: synthGstin(rng)
    };
    clientOrgs.push(clientOrg);

    if (persist) {
      await ClientOrganizationModel.create({
        _id: clientOrg._id,
        tenantId: clientOrg.tenantId,
        gstin: clientOrg.gstin,
        companyName: `${tenant.name} Pvt Ltd`
      });
    }

    for (let v = 0; v < vendorsPerTenant; v++) {
      const vendor: FixtureVendor = {
        _id: deterministicObjectId(`vendor:${t}:${v}`),
        clientOrgId: clientOrg._id,
        name: `Vendor ${t}-${v}`,
        gstin: synthGstin(rng),
        pan: synthPan(rng)
      };
      vendors.push(vendor);

      if (persist) {
        await VendorMasterModel.create({
          _id: vendor._id,
          tenantId: clientOrg.tenantId,
          clientOrgId: vendor.clientOrgId,
          vendorFingerprint: `vendor-${t}-${v}`,
          name: vendor.name,
          gstin: vendor.gstin,
          pan: vendor.pan,
          invoiceCount: invoicesPerVendor,
          lastInvoiceDate: FIXTURE_NOW
        });
      }

      for (let i = 0; i < invoicesPerVendor; i++) {
        const totalAmountMinor = pickInt(rng, 100_00, 5_000_00);
        const invoice: FixtureInvoice = {
          _id: deterministicObjectId(`invoice:${t}:${v}:${i}`),
          clientOrgId: clientOrg._id,
          vendorName: vendor.name,
          totalAmountMinor,
          invoiceNumber: `INV-${t}-${v}-${i}`
        };
        invoices.push(invoice);

        if (persist) {
          await InvoiceModel.create({
            _id: invoice._id,
            tenantId: clientOrg.tenantId,
            clientOrgId: invoice.clientOrgId,
            workloadTier: "standard",
            sourceType: "harness",
            sourceKey: `harness-${seed}`,
            sourceDocumentId: `doc-${t}-${v}-${i}`,
            attachmentName: `${invoice.invoiceNumber}.pdf`,
            mimeType: "application/pdf",
            receivedAt: FIXTURE_NOW,
            status: INVOICE_STATUS.PARSED,
            parsed: {
              invoiceNumber: invoice.invoiceNumber,
              vendorName: invoice.vendorName,
              vendorGstin: vendor.gstin ?? undefined,
              vendorPan: vendor.pan ?? undefined,
              invoiceDate: FIXTURE_NOW,
              totalAmountMinor,
              currency: "INR"
            }
          });
        }
      }
    }
  }

  return { tenants, clientOrgs, vendors, invoices };
}

function synthGstin(rng: () => number): string {
  const stateCode = String(pickInt(rng, 1, 37)).padStart(2, "0");
  const pan = synthPan(rng);
  return `${stateCode}${pan}1Z${pickAlnum(rng)}`;
}

function synthPan(rng: () => number): string {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const head = Array.from({ length: 5 }, () =>
    letters[pickInt(rng, 0, 25)]
  ).join("");
  const digits = String(pickInt(rng, 1000, 9999));
  const tail = letters[pickInt(rng, 0, 25)];
  return `${head}${digits}${tail}`;
}

function pickAlnum(rng: () => number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  return chars[pickInt(rng, 0, chars.length - 1)];
}
