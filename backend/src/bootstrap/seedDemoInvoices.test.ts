/**
 * Tests for the demo-tenant invoice seed.
 *
 * Mongoose models are mocked with in-memory stores so we can assert the final
 * seeded state without spinning up Mongo. `fs.readFileSync` is stubbed so the
 * seed's fixture loader returns deterministic parsed values without hitting
 * disk.
 */

type Row = Record<string, unknown>;

let invoiceStore: Row[] = [];
let exportBatchStore: Row[] = [];
let notificationStore: Row[] = [];

let exportIdCounter = 0;
function nextExportId(): string {
  exportIdCounter += 1;
  return `batch-${exportIdCounter}`;
}

function rowMatches(row: Row, query: Row): boolean {
  for (const [key, expected] of Object.entries(query)) {
    const actual = row[key];
    if (expected && typeof expected === "object" && "$in" in (expected as Row)) {
      const arr = (expected as { $in: unknown[] }).$in;
      if (!arr.includes(actual)) return false;
      continue;
    }
    if (expected && typeof expected === "object" && "$regex" in (expected as Row)) {
      const rx = (expected as { $regex: RegExp }).$regex;
      if (typeof actual !== "string" || !rx.test(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

jest.mock("@/models/core/User.js", () => ({
  UserModel: {
    findOne: jest.fn((query: { email: string }) => ({
      lean: async () => {
        if (query.email === "mahir.n@globalhealthx.co") return { _id: "mahir-user-id" };
        if (query.email === "mahir-ap-clerk@neelam.test") return { _id: "ap-clerk-user-id" };
        if (query.email === "mahir-senior-accountant@neelam.test") return { _id: "senior-user-id" };
        return null;
      }
    }))
  }
}));

jest.mock("@/models/compliance/VendorMaster.js", () => ({
  VendorMasterModel: {
    findOne: jest.fn((query: { tenantId: string; vendorFingerprint: string }) => ({
      lean: async () => {
        if (query.vendorFingerprint === "sprinto-technology-private-limited") {
          return { _id: "vendor-sprinto-id", tenantId: query.tenantId };
        }
        if (query.vendorFingerprint === "delta-engineering-works") {
          return { _id: "vendor-delta-id", tenantId: query.tenantId };
        }
        return null;
      }
    }))
  }
}));

jest.mock("@/models/invoice/ApprovalWorkflow.js", () => ({
  ApprovalWorkflowModel: {
    findOne: jest.fn(() => ({
      select: () => ({ lean: async () => ({ _id: "workflow-id-1" }) })
    }))
  }
}));

jest.mock("@/models/invoice/Invoice.js", () => ({
  InvoiceModel: {
    deleteMany: jest.fn(async (query: Row) => {
      const before = invoiceStore.length;
      invoiceStore = invoiceStore.filter((row) => !rowMatches(row, query));
      return { deletedCount: before - invoiceStore.length };
    }),
    insertMany: jest.fn(async (docs: Row[]) => {
      invoiceStore.push(...docs.map((d) => ({ ...d })));
      return docs;
    }),
    find: jest.fn((query: Row) => ({
      lean: async () => invoiceStore.filter((row) => rowMatches(row, query))
    }))
  }
}));

jest.mock("@/models/invoice/ExportBatch.js", () => ({
  ExportBatchModel: {
    deleteMany: jest.fn(async (query: Row) => {
      const before = exportBatchStore.length;
      exportBatchStore = exportBatchStore.filter((row) => !rowMatches(row, query));
      return { deletedCount: before - exportBatchStore.length };
    }),
    create: jest.fn(async (doc: Row) => {
      const id = nextExportId();
      const row = { ...doc, _id: id };
      exportBatchStore.push(row);
      return row;
    })
  }
}));

jest.mock("@/models/integration/MailboxNotificationEvent.js", () => ({
  MailboxNotificationEventModel: {
    deleteMany: jest.fn(async (query: Row) => {
      const before = notificationStore.length;
      notificationStore = notificationStore.filter((row) => !rowMatches(row, query));
      return { deletedCount: before - notificationStore.length };
    }),
    insertMany: jest.fn(async (docs: Row[]) => {
      notificationStore.push(...docs.map((d) => ({ ...d })));
      return docs;
    })
  }
}));

/* ----------------------------------------------------------- fs mock */

// Keep the real fs for non-fixture reads (none in this path, but safe) while
// returning deterministic fixture bodies for `dev/sample-invoices/baked/<dir>/
// extraction.json`. PNG reads aren't exercised here because the test doesn't
// supply a FileStore.
jest.mock("node:fs", () => {
  const actual = jest.requireActual<typeof import("node:fs")>("node:fs");
  const buildFixture = (attachmentName: string): Record<string, unknown> => {
    const stem = attachmentName.replace(/\.pdf$/i, "");
    return {
    sourceFilename: attachmentName,
    mimeType: "application/pdf",
    parsed: {
      invoiceNumber: `${stem}-number`,
      vendorName: `${stem}-vendor`,
      invoiceDate: "2026-03-15T00:00:00.000Z",
      totalAmountMinor: 100000,
      currency: "INR",
      customerName: "Global Innovation Hub",
      customerAddress: "Sanali Spazio, Hitech City, Hyderabad"
    },
    ocrBlocks: [],
    fieldProvenance: {
      invoiceNumber: { source: "llama-extract", page: 1, bboxNormalized: [0, 0, 0.1, 0.1] }
    },
    lineItemProvenance: [],
    extraction: { source: "llamaparse", strategy: "llama-extract" },
    confidenceScore: 90,
    confidenceTone: "green",
    previewPageImages: {}
    };
  };
  return {
    ...actual,
    readFileSync: (path: string | URL | number, options?: unknown) => {
      const pathStr = typeof path === "string" ? path : String(path);
      const match = /dev\/sample-invoices\/baked\/([^/]+)\/extraction\.json$/.exec(pathStr);
      if (match) {
        const dir = match[1];
        const attachmentName = `${dir}.pdf`;
        return JSON.stringify(buildFixture(attachmentName));
      }
      return actual.readFileSync(path as never, options as never);
    },
    existsSync: (path: string | URL) => {
      const pathStr = typeof path === "string" ? path : String(path);
      // Match both the directory itself (used by the fixture resolver's
      // upward walk from cwd) and the per-invoice extraction.json paths.
      if (/dev\/sample-invoices\/baked(\/[^/]+\/extraction\.json)?$/.test(pathStr)) {
        return true;
      }
      return actual.existsSync(path as never);
    }
  };
});

/* ----------------------------------------------------------- import under test */

import { seedDemoInvoices } from "./seedDemoInvoices.js";

const TENANT_ID = "65f0000000000000000000c3";

beforeEach(() => {
  invoiceStore = [];
  exportBatchStore = [];
  notificationStore = [];
  exportIdCounter = 0;
});

function byAttachment(name: string): Row | undefined {
  return invoiceStore.find((r) => r.attachmentName === name);
}

describe("seedDemoInvoices", () => {
  it("is idempotent: re-running produces 6 invoices, 1 export batch, 3 notification events with no duplicates", async () => {
    await seedDemoInvoices(TENANT_ID);
    await seedDemoInvoices(TENANT_ID);

    expect(invoiceStore).toHaveLength(6);
    expect(exportBatchStore).toHaveLength(1);
    expect(notificationStore).toHaveLength(3);
  });

  it("invoice #1 (INV-FY2526-939.pdf) is EXPORTED with export.batchId resolving to the seeded batch", async () => {
    await seedDemoInvoices(TENANT_ID);

    const inv = byAttachment("INV-FY2526-939.pdf");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("EXPORTED");
    const exportSub = inv!.export as Row;
    expect(exportSub.system).toBe("demo-seed");
    expect(exportSub.batchId).toBe(exportBatchStore[0]._id);
  });

  it("invoice #3 (FC-Vector_.pdf) is AWAITING_APPROVAL with workflowState.currentStep === 2", async () => {
    await seedDemoInvoices(TENANT_ID);

    const inv = byAttachment("FC-Vector_.pdf");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("AWAITING_APPROVAL");
    const wf = inv!.workflowState as Row;
    expect(wf.currentStep).toBe(2);
    expect(wf.status).toBe("in_progress");
  });

  it("invoice #4 (FC-Focus_Bills.pdf) is NEEDS_REVIEW with 2 open risk signals (MSME + above-expected)", async () => {
    await seedDemoInvoices(TENANT_ID);

    const inv = byAttachment("FC-Focus_Bills.pdf");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("NEEDS_REVIEW");
    const compliance = inv!.compliance as Row;
    const signals = compliance.riskSignals as Array<Row>;
    expect(signals).toHaveLength(2);

    const codes = signals.map((s) => s.code);
    expect(codes).toEqual(expect.arrayContaining(["MSME_PAYMENT_DUE_SOON", "TOTAL_AMOUNT_ABOVE_EXPECTED"]));
    expect(signals.every((s) => s.status === "open")).toBe(true);

    const msme = signals.find((s) => s.code === "MSME_PAYMENT_DUE_SOON")!;
    expect(msme.category).toBe("compliance");
    expect(msme.severity).toBe("warning");

    const above = signals.find((s) => s.code === "TOTAL_AMOUNT_ABOVE_EXPECTED")!;
    expect(above.category).toBe("financial");
    expect(above.severity).toBe("warning");
  });

  it("invoice #6 (FC-G4S Facility_.pdf) is AWAITING_APPROVAL with workflowState.status === 'rejected'", async () => {
    await seedDemoInvoices(TENANT_ID);

    const inv = byAttachment("FC-G4S Facility_.pdf");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("AWAITING_APPROVAL");
    const wf = inv!.workflowState as Row;
    expect(wf.status).toBe("rejected");
    const stepResults = wf.stepResults as Array<Row>;
    expect(stepResults).toHaveLength(1);
    expect(stepResults[0].action).toBe("rejected");
  });

  it("parsed values come from the baked fixture (not hardcoded in the seed)", async () => {
    await seedDemoInvoices(TENANT_ID);
    const inv = byAttachment("INV-FY2526-939.pdf");
    const parsed = inv!.parsed as Row;
    expect(parsed.invoiceNumber).toBe("INV-FY2526-939-number");
    expect(parsed.vendorName).toBe("INV-FY2526-939-vendor");
    expect(inv!.confidenceScore).toBe(90);
    expect(inv!.confidenceTone).toBe("green");
  });
});
