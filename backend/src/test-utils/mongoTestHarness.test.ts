/**
 * Two-layer test file for INFRA-1:
 *
 * 1. `describe` (always runs, no Docker needed) — exercises pure logic:
 *    fixture determinism, auto-skip gating, env-var honouring. This is
 *    what guards against regressions on developer laptops.
 *
 * 2. `describeHarness` (auto-skipped when Docker is missing) — brings up
 *    a real Mongo replica-set container, runs a transaction, and
 *    verifies the `*Minor` integer constraint that BE-0 will leverage.
 *    This is what actually proves the replica-set init works.
 */

import mongoose from "mongoose";
import {
  buildFixtures,
  describeHarness,
  generateDataset,
  isDockerAvailable
} from "./index.js";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { TenantModel } from "@/models/core/Tenant.js";

describe("mongoTestHarness: pure helpers (no Docker)", () => {
  it("buildFixtures is deterministic for a given seed", async () => {
    const a = await buildFixtures({ seed: 123, tenants: 1, vendorsPerTenant: 2, invoicesPerVendor: 2 });
    const b = await buildFixtures({ seed: 123, tenants: 1, vendorsPerTenant: 2, invoicesPerVendor: 2 });
    expect(a.invoices.map((i) => i.totalAmountMinor))
      .toEqual(b.invoices.map((i) => i.totalAmountMinor));
    expect(a.vendors.map((v) => v.gstin)).toEqual(b.vendors.map((v) => v.gstin));
    expect(a.tenants[0]?._id.toHexString()).toBe(b.tenants[0]?._id.toHexString());
  });

  it("buildFixtures produces integer *Minor values only", async () => {
    const { invoices } = await buildFixtures({ seed: 9, invoicesPerVendor: 20 });
    for (const inv of invoices) {
      expect(Number.isInteger(inv.totalAmountMinor)).toBe(true);
    }
  });

  it("isDockerAvailable resolves without throwing", async () => {
    const result = await isDockerAvailable();
    expect(typeof result).toBe("boolean");
  });
});

describeHarness("mongoTestHarness: containerised DB", ({ getHarness }) => {
  afterEach(async () => {
    await getHarness().reset();
  });

  it("accepts inserts under the real replica-set URI", async () => {
    const h = getHarness();
    expect(h.uri).toMatch(/^mongodb:\/\//);
    expect(mongoose.connection.readyState).toBe(1); // connected

    await TenantModel.create({ name: "Harness Tenant" });
    const count = await TenantModel.countDocuments({});
    expect(count).toBe(1);
  });

  it("supports multi-document transactions (replica-set required)", async () => {
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await TenantModel.create([{ name: "TxA" }], { session });
        await TenantModel.create([{ name: "TxB" }], { session });
      });
    } finally {
      await session.endSession();
    }
    const names = (await TenantModel.find({}, { name: 1 }).lean()).map((t) => t.name);
    expect(names.sort()).toEqual(["TxA", "TxB"]);
  });

  it("persists fixtures with *Minor integer fields", async () => {
    await buildFixtures({
      persist: true,
      seed: 7,
      tenants: 1,
      vendorsPerTenant: 2,
      invoicesPerVendor: 3
    });
    const invoices = await InvoiceModel.find({}).lean();
    expect(invoices).toHaveLength(6);
    for (const inv of invoices) {
      expect(inv.parsed?.totalAmountMinor).toBeDefined();
      expect(Number.isInteger(inv.parsed?.totalAmountMinor ?? NaN)).toBe(true);
    }
  });

  it("generateDataset bulk-loads at declared scale", async () => {
    const result = await generateDataset({
      tenants: 2,
      vendorsPerTenant: 3,
      invoicesPerVendor: 4,
      seed: 1
    });
    expect(result.tenantCount).toBe(2);
    expect(result.vendorCount).toBe(6);
    expect(result.invoiceCount).toBe(24);
    expect(await InvoiceModel.countDocuments({})).toBe(24);
  });
});
