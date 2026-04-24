import mongoose, { Types } from "mongoose";
import { describeHarness } from "@/test-utils/index.ts";
import { InvoiceModel } from "@/models/invoice/Invoice.js";
import { INVOICE_STATUS, RISK_SIGNAL_CATEGORY, RISK_SIGNAL_SEVERITY, RISK_SIGNAL_STATUS } from "@/types/invoice.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";
import {
  ACTION_REASON,
  ACTION_REASON_SEVERITY,
  classifyActionReason,
  emptyReasonCounts,
  fetchActionRequired,
  type ActionReason
} from "./actionRequired.ts";

describe("ACTION_REASON enum stability (drift guard)", () => {
  it("preserves exactly the FE-contract reason set", () => {
    expect(Object.values(ACTION_REASON).sort()).toEqual(
      ["AwaitingApproval", "CriticalRisk", "ExportFailed", "FailedOcr", "MissingGstin", "NeedsReview"].sort()
    );
  });

  it("preserves exactly the FE-contract severity ranks", () => {
    expect(ACTION_REASON_SEVERITY).toEqual({
      FailedOcr: 100,
      CriticalRisk: 90,
      ExportFailed: 80,
      MissingGstin: 70,
      NeedsReview: 50,
      AwaitingApproval: 30
    });
  });
});

describe("classifyActionReason", () => {
  const baseINR = { parsed: { currency: "INR", customerGstin: "27AAAAA0000A1Z5" } };

  it.each<[string, Parameters<typeof classifyActionReason>[0], ActionReason | null]>([
    ["FAILED_OCR -> FailedOcr", { status: INVOICE_STATUS.FAILED_OCR, ...baseINR }, ACTION_REASON.FailedOcr],
    ["FAILED_PARSE -> FailedOcr", { status: INVOICE_STATUS.FAILED_PARSE, ...baseINR }, ACTION_REASON.FailedOcr],
    ["export.error set -> ExportFailed", { status: INVOICE_STATUS.EXPORTED, ...baseINR, export: { error: "boom" } }, ACTION_REASON.ExportFailed],
    [
      "open critical risk -> CriticalRisk",
      {
        status: INVOICE_STATUS.PARSED,
        ...baseINR,
        compliance: {
          riskSignals: [
            { severity: RISK_SIGNAL_SEVERITY.CRITICAL, status: RISK_SIGNAL_STATUS.OPEN }
          ]
        }
      },
      ACTION_REASON.CriticalRisk
    ],
    [
      "dismissed critical risk ignored",
      {
        status: INVOICE_STATUS.PARSED,
        ...baseINR,
        compliance: {
          riskSignals: [
            { severity: RISK_SIGNAL_SEVERITY.CRITICAL, status: RISK_SIGNAL_STATUS.DISMISSED }
          ]
        }
      },
      null
    ],
    [
      "open warning not critical",
      {
        status: INVOICE_STATUS.PARSED,
        ...baseINR,
        compliance: {
          riskSignals: [
            { severity: RISK_SIGNAL_SEVERITY.WARNING, status: RISK_SIGNAL_STATUS.OPEN }
          ]
        }
      },
      null
    ],
    [
      "missing customer GSTIN on INR past PENDING -> MissingGstin",
      { status: INVOICE_STATUS.PARSED, parsed: { currency: "INR", customerGstin: "" } },
      ACTION_REASON.MissingGstin
    ],
    [
      "missing customer GSTIN on PENDING ignored",
      { status: INVOICE_STATUS.PENDING, parsed: { currency: "INR", customerGstin: "" } },
      null
    ],
    [
      "missing customer GSTIN on non-INR ignored",
      { status: INVOICE_STATUS.PARSED, parsed: { currency: "USD", customerGstin: "" } },
      null
    ],
    ["NEEDS_REVIEW -> NeedsReview", { status: INVOICE_STATUS.NEEDS_REVIEW, ...baseINR }, ACTION_REASON.NeedsReview],
    ["AWAITING_APPROVAL -> AwaitingApproval", { status: INVOICE_STATUS.AWAITING_APPROVAL, ...baseINR }, ACTION_REASON.AwaitingApproval],
    ["PARSED with all fields fine -> null", { status: INVOICE_STATUS.PARSED, ...baseINR }, null]
  ])("%s", (_label, invoice, expected) => {
    expect(classifyActionReason(invoice)).toBe(expected);
  });

  it("FailedOcr wins over MissingGstin when both present", () => {
    expect(classifyActionReason({
      status: INVOICE_STATUS.FAILED_OCR,
      parsed: { currency: "INR", customerGstin: "" }
    })).toBe(ACTION_REASON.FailedOcr);
  });

  it("ExportFailed wins over CriticalRisk", () => {
    expect(classifyActionReason({
      status: INVOICE_STATUS.EXPORTED,
      parsed: { currency: "INR", customerGstin: "x" },
      export: { error: "export failed" },
      compliance: {
        riskSignals: [{ severity: RISK_SIGNAL_SEVERITY.CRITICAL, status: RISK_SIGNAL_STATUS.OPEN }]
      }
    })).toBe(ACTION_REASON.ExportFailed);
  });
});

describe("emptyReasonCounts", () => {
  it("returns zero for every reason", () => {
    const counts = emptyReasonCounts();
    for (const reason of Object.values(ACTION_REASON)) {
      expect(counts[reason]).toBe(0);
    }
  });
});

describeHarness("fetchActionRequired (mongo aggregation)", ({ getHarness }) => {
  const tenantId = "tenant-ar-test";
  const otherTenantId = "tenant-ar-other";

  async function seed(): Promise<Record<string, Types.ObjectId>> {
    const ids: Record<string, Types.ObjectId> = {};
    const docs: Array<{ key: string; overrides: Record<string, unknown>; daysAgo: number }> = [
      { key: "failedOcr", overrides: { status: INVOICE_STATUS.FAILED_OCR }, daysAgo: 1 },
      { key: "failedParse", overrides: { status: INVOICE_STATUS.FAILED_PARSE }, daysAgo: 2 },
      { key: "criticalRisk", overrides: {
          status: INVOICE_STATUS.PARSED,
          compliance: { riskSignals: [{
            code: RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED,
            category: RISK_SIGNAL_CATEGORY.FRAUD,
            severity: RISK_SIGNAL_SEVERITY.CRITICAL,
            message: "bank changed",
            confidencePenalty: 20,
            status: RISK_SIGNAL_STATUS.OPEN
          }] }
      }, daysAgo: 3 },
      { key: "exportFailed", overrides: { status: INVOICE_STATUS.EXPORTED, export: { system: "tally", error: "gstin mismatch" } }, daysAgo: 4 },
      { key: "missingGstin", overrides: { status: INVOICE_STATUS.PARSED, parsed: { currency: "INR", customerGstin: "", vendorName: "MG Vendor", totalAmountMinor: 12345 } }, daysAgo: 5 },
      { key: "needsReview", overrides: { status: INVOICE_STATUS.NEEDS_REVIEW }, daysAgo: 6 },
      { key: "awaitingApproval", overrides: { status: INVOICE_STATUS.AWAITING_APPROVAL }, daysAgo: 7 },
      { key: "clean", overrides: { status: INVOICE_STATUS.APPROVED }, daysAgo: 8 },
      { key: "pendingMissingGstinIgnored", overrides: { status: INVOICE_STATUS.PENDING, parsed: { currency: "INR", customerGstin: "" } }, daysAgo: 9 }
    ];

    const now = Date.now();
    for (const { key, overrides, daysAgo } of docs) {
      const _id = new Types.ObjectId();
      ids[key] = _id;
      const base = {
        _id,
        tenantId,
        workloadTier: "standard",
        sourceType: "harness",
        sourceKey: `harness-${key}`,
        sourceDocumentId: `doc-${key}`,
        attachmentName: `${key}.pdf`,
        mimeType: "application/pdf",
        receivedAt: new Date(now - daysAgo * 86_400_000),
        createdAt: new Date(now - daysAgo * 86_400_000),
        updatedAt: new Date(now - daysAgo * 86_400_000),
        status: INVOICE_STATUS.PARSED,
        parsed: { currency: "INR", customerGstin: "27AAAAA0000A1Z5", vendorName: `${key} vendor`, totalAmountMinor: 10_000 }
      };
      const merged = { ...base, ...overrides };
      if ((overrides as { parsed?: unknown }).parsed) {
        merged.parsed = { ...base.parsed, ...(overrides as { parsed: Record<string, unknown> }).parsed };
      }
      await InvoiceModel.collection.insertOne(merged as unknown as Record<string, unknown>);
    }

    await InvoiceModel.collection.insertOne({
      _id: new Types.ObjectId(),
      tenantId: otherTenantId,
      workloadTier: "standard",
      sourceType: "harness",
      sourceKey: "harness-leak",
      sourceDocumentId: "doc-leak",
      attachmentName: "leak.pdf",
      mimeType: "application/pdf",
      receivedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      status: INVOICE_STATUS.FAILED_OCR,
      parsed: { currency: "INR", customerGstin: "", vendorName: "Leak vendor", totalAmountMinor: 99 }
    });

    return ids;
  }

  beforeEach(async () => {
    getHarness();
    await InvoiceModel.deleteMany({});
  });

  it("returns an empty result for an unseeded tenant", async () => {
    const result = await fetchActionRequired({ tenantId: "empty-tenant", limit: 50, cursor: null });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(result.total).toBe(0);
    expect(result.totalByReason).toEqual(emptyReasonCounts());
  });

  it("classifies every reason and sorts by severity desc", async () => {
    await seed();
    const result = await fetchActionRequired({ tenantId, limit: 50, cursor: null });

    const reasonsInOrder = result.items.map((i) => i.reason);
    expect(reasonsInOrder.slice(0, 2).every((r) => r === ACTION_REASON.FailedOcr)).toBe(true);
    expect(reasonsInOrder).toContain(ACTION_REASON.CriticalRisk);
    expect(reasonsInOrder).toContain(ACTION_REASON.ExportFailed);
    expect(reasonsInOrder).toContain(ACTION_REASON.MissingGstin);
    expect(reasonsInOrder).toContain(ACTION_REASON.NeedsReview);
    expect(reasonsInOrder).toContain(ACTION_REASON.AwaitingApproval);

    const severities = result.items.map((i) => i.severity);
    for (let i = 1; i < severities.length; i++) {
      expect(severities[i - 1]).toBeGreaterThanOrEqual(severities[i]);
    }

    expect(result.totalByReason).toEqual({
      [ACTION_REASON.FailedOcr]: 2,
      [ACTION_REASON.CriticalRisk]: 1,
      [ACTION_REASON.ExportFailed]: 1,
      [ACTION_REASON.MissingGstin]: 1,
      [ACTION_REASON.NeedsReview]: 1,
      [ACTION_REASON.AwaitingApproval]: 1
    });
    expect(result.total).toBe(7);
  });

  it("does not leak invoices from other tenants", async () => {
    await seed();
    const other = await fetchActionRequired({ tenantId: otherTenantId, limit: 50, cursor: null });
    expect(other.items).toHaveLength(1);
    expect(other.total).toBe(1);
    expect(other.items[0].reason).toBe(ACTION_REASON.FailedOcr);
  });

  it("paginates disjointly using opaque cursor", async () => {
    await seed();
    const page1 = await fetchActionRequired({ tenantId, limit: 3, cursor: null });
    expect(page1.items).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    expect(page1.total).toBe(7);

    const page2 = await fetchActionRequired({ tenantId, limit: 3, cursor: page1.nextCursor });
    expect(page2.items).toHaveLength(3);
    expect(page2.nextCursor).not.toBeNull();

    const page3 = await fetchActionRequired({ tenantId, limit: 3, cursor: page2.nextCursor });
    expect(page3.items).toHaveLength(1);
    expect(page3.nextCursor).toBeNull();

    const ids = new Set<string>();
    for (const item of [...page1.items, ...page2.items, ...page3.items]) {
      expect(ids.has(item.invoiceId)).toBe(false);
      ids.add(item.invoiceId);
    }
    expect(ids.size).toBe(7);
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await InvoiceModel.deleteMany({});
    }
  });
});
