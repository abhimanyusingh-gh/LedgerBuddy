/**
 * Deterministic fixture generator for the accounting-payments test harness.
 *
 * Goals:
 * - Every call with the same `seed` produces the same documents (no
 *   `Date.now()`, no `Math.random()`, no `randomUUID()` outside of a
 *   seeded PRNG).
 * - All money fields land on the `*Minor` integer schema fields used
 *   across the codebase (see `src/models/invoice/Invoice.ts` and
 *   `src/types/invoice.ts` `INVOICE_FIELD_KEY.TOTAL_AMOUNT_MINOR`).
 * - Reuses existing mongoose models — no schema duplication.
 *
 * NOT a replacement for `seedDemoInvoices` / `seedLocalDemoData`. Those
 * seed real demo data tied to a baked OCR fixture set; this file is for
 * synthetic data in unit/integration tests.
 */

import { createHash } from "node:crypto";
import { Types } from "mongoose";
import { TenantModel } from "@/models/core/Tenant.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";

/** Pinned wall-clock to keep `receivedAt`, `lastInvoiceDate`, etc. stable. */
export const FIXTURE_NOW = new Date("2026-04-23T00:00:00.000Z");

/**
 * Tiny LCG PRNG. Seeded so the same `seed` produces the same sequence
 * of vendors / invoices across test runs and across machines. Avoids
 * pulling `seedrandom` / `faker` into devDeps.
 */
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

/**
 * Deterministic ObjectId — uses a 24-char hex string derived from the
 * full tuple key so the same fixture call yields the same `_id`.
 *
 * The caller is responsible for encoding the full tuple (e.g.
 * `invoice:${t}:${v}:${i}`) rather than a single scalar — this avoids
 * collisions at perf scale where a packed `t*1000 + v` or `idx*100 + i`
 * index would alias across distinct (t,v,i) triples.
 */
function deterministicObjectId(key: string): Types.ObjectId {
  // SHA-1 → 40 hex chars, use first 24 for a valid ObjectId. The tuple
  // encoding in `key` is what guarantees uniqueness across the harness
  // scale (tenants × vendors × invoices).
  const hex = createHash("sha1").update(key).digest("hex").slice(0, 24);
  return new Types.ObjectId(hex);
}

export interface FixtureTenant {
  _id: Types.ObjectId;
  name: string;
}

export interface FixtureVendor {
  _id: Types.ObjectId;
  tenantId: string;
  name: string;
  gstin: string | null;
  pan: string | null;
}

export interface FixtureInvoice {
  _id: Types.ObjectId;
  tenantId: string;
  vendorName: string;
  totalAmountMinor: number;
  invoiceNumber: string;
}

export interface FixtureOptions {
  /** Number of tenants (default 1). */
  tenants?: number;
  /** Vendors per tenant (default 3). */
  vendorsPerTenant?: number;
  /** Invoices per vendor (default 5). */
  invoicesPerVendor?: number;
  /** Seed for the deterministic PRNG (default 42). */
  seed?: number;
  /**
   * When `true`, persists docs via `mongoose.Model.create`. Requires an
   * active connection to the harness — see `startMongoHarness()`.
   * When `false` (default), returns plain objects only.
   */
  persist?: boolean;
}

export interface FixtureSet {
  tenants: FixtureTenant[];
  vendors: FixtureVendor[];
  invoices: FixtureInvoice[];
}

/**
 * Build a deterministic fixture tree (tenants → vendors → invoices).
 *
 * Example (in-memory only):
 * ```ts
 * const { tenants, vendors, invoices } = await buildFixtures({ seed: 7 });
 * ```
 *
 * Example (persisted to harness Mongo):
 * ```ts
 * const { tenants } = await buildFixtures({ persist: true });
 * ```
 */
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

    for (let v = 0; v < vendorsPerTenant; v++) {
      const vendor: FixtureVendor = {
        _id: deterministicObjectId(`vendor:${t}:${v}`),
        tenantId: String(tenant._id),
        name: `Vendor ${t}-${v}`,
        gstin: synthGstin(rng),
        pan: synthPan(rng)
      };
      vendors.push(vendor);

      if (persist) {
        await VendorMasterModel.create({
          _id: vendor._id,
          tenantId: vendor.tenantId,
          vendorFingerprint: `vendor-${t}-${v}`,
          name: vendor.name,
          gstin: vendor.gstin,
          pan: vendor.pan,
          invoiceCount: invoicesPerVendor,
          lastInvoiceDate: FIXTURE_NOW
        });
      }

      for (let i = 0; i < invoicesPerVendor; i++) {
        // Integer minor units — the validator on `parsed.totalAmountMinor`
        // (Invoice.ts:181) requires `Number.isInteger(value)`.
        const totalAmountMinor = pickInt(rng, 100_00, 5_000_00);
        const invoice: FixtureInvoice = {
          _id: deterministicObjectId(`invoice:${t}:${v}:${i}`),
          tenantId: vendor.tenantId,
          vendorName: vendor.name,
          totalAmountMinor,
          invoiceNumber: `INV-${t}-${v}-${i}`
        };
        invoices.push(invoice);

        if (persist) {
          await InvoiceModel.create({
            _id: invoice._id,
            tenantId: invoice.tenantId,
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

  return { tenants, vendors, invoices };
}

/** Synthetic GSTIN — 15 chars, uppercase alphanumeric. Not Luhn-valid. */
function synthGstin(rng: () => number): string {
  const stateCode = String(pickInt(rng, 1, 37)).padStart(2, "0");
  const pan = synthPan(rng);
  return `${stateCode}${pan}1Z${pickAlnum(rng)}`;
}

/** Synthetic PAN — 10-char ABCDE1234F shape. */
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
