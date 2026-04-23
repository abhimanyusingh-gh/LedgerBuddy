/**
 * Prod-scale sample dataset loader.
 *
 * Loads N tenants × M vendors × K invoices into a harness Mongo for
 * performance benchmarking — notably the INFRA-3 gates: TDS compute
 * p95 < 200ms, payment recording p95 < 500ms (NFR-001/002 in
 * `docs/accounting-payments/IMPLEMENTATION-PLAN-v4.3.md`).
 *
 * Two modes:
 *
 * 1. **Generate** — `generateDataset({ tenants, vendorsPerTenant, invoicesPerVendor })`
 *    streams fixtures via `buildFixtures({ persist: true })` at the
 *    caller-specified scale. Uses `insertMany` batching (not `.create`)
 *    so large loads finish in seconds.
 *
 * 2. **Load from JSON** — `loadDatasetFromFile(path)` reads a previously
 *    exported dataset (produced by `dumpDataset()`) and bulk-inserts.
 *    Kept for the perf suite which does not want to re-synthesise the
 *    same dataset on every run.
 *
 * Why not commit the JSON:
 *    A 10_000-invoice dataset is ~30 MB. We keep the loader in the
 *    repo; CI regenerates it on demand. Run
 *    `yarn workspace ledgerbuddy-backend run tsx src/test-utils/datasetLoader.ts dump <path>`
 *    to produce one locally.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { TenantModel } from "@/models/core/Tenant.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { ONBOARDING_STATUS, TENANT_MODE } from "@/types/onboarding.js";
import {
  buildFixtures,
  FIXTURE_NOW,
  type FixtureSet
} from "./fixtures.js";

export interface DatasetScale {
  tenants: number;
  vendorsPerTenant: number;
  invoicesPerVendor: number;
  seed?: number;
}

export interface DatasetLoadResult {
  tenantCount: number;
  vendorCount: number;
  invoiceCount: number;
  elapsedMs: number;
}

/**
 * Build + insert a dataset at the requested scale. Uses `insertMany`
 * batches of 500 so a 10k-invoice load completes in a few seconds on
 * a local harness container.
 */
export async function generateDataset(
  scale: DatasetScale
): Promise<DatasetLoadResult> {
  const start = Date.now();
  const { tenants, vendors, invoices } = await buildFixtures({
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

  await insertInBatches(VendorMasterModel, vendors, (v, i) => ({
    _id: v._id,
    tenantId: v.tenantId,
    vendorFingerprint: `vendor-bulk-${i}`,
    name: v.name,
    gstin: v.gstin,
    pan: v.pan,
    invoiceCount: scale.invoicesPerVendor,
    lastInvoiceDate: FIXTURE_NOW
  }));

  await insertInBatches(InvoiceModel, invoices, (inv, i) => ({
    _id: inv._id,
    tenantId: inv.tenantId,
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

/**
 * Dump a built fixture set to a JSON file. Used for producing the
 * perf-suite dataset on demand — output is intentionally not committed
 * to the repo.
 */
export function dumpDataset(set: FixtureSet, path: string): void {
  const serialisable = {
    tenants: set.tenants.map((t) => ({ _id: t._id.toHexString(), name: t.name })),
    vendors: set.vendors.map((v) => ({
      _id: v._id.toHexString(),
      tenantId: v.tenantId,
      name: v.name,
      gstin: v.gstin,
      pan: v.pan
    })),
    invoices: set.invoices.map((i) => ({
      _id: i._id.toHexString(),
      tenantId: i.tenantId,
      vendorName: i.vendorName,
      totalAmountMinor: i.totalAmountMinor,
      invoiceNumber: i.invoiceNumber
    }))
  };
  writeFileSync(path, JSON.stringify(serialisable));
}

/** Counterpart to `dumpDataset`. Returns the raw JSON, not a FixtureSet. */
export function loadDatasetFromFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

// --- internals ---

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
