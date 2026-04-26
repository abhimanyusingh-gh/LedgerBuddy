import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Types } from "mongoose";

import { UserModel } from "@/models/core/User.js";
import {
  InvoiceModel,
  type InvoiceExport,
  type InvoiceWorkflowState
} from "@/models/invoice/Invoice.js";
import { ExportBatchModel } from "@/models/invoice/ExportBatch.js";
import { ApprovalWorkflowModel } from "@/models/invoice/ApprovalWorkflow.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { MailboxNotificationEventModel } from "@/models/integration/MailboxNotificationEvent.js";
import { INVOICE_STATUS, type ComplianceRiskSignal } from "@/types/invoice.js";
import type { ConfidenceTone } from "@/types/confidence.js";
import type { FileStore } from "@/core/interfaces/FileStore.js";
import { logger } from "@/utils/logger.js";

/**
 * Demo-seed constants.
 *
 * `DEMO_SOURCE_KEY` doubles as the idempotency marker for invoice docs (every
 * seeded invoice carries `sourceKey: "demo-seed"`) and `DEMO_EXPORT_SYSTEM`
 * serves the same purpose for `ExportBatch` rows. Notification events are
 * tagged via a `reason: "demo-seed:<type>"` prefix.
 */
const DEMO_SOURCE_KEY = "demo-seed";
const DEMO_EXPORT_SYSTEM = "demo-seed";
const DEMO_NOTIFICATION_REASON_PREFIX = "demo-seed:";

/**
 * Filenames of the 6 demo invoices whose fixtures must exist under
 * `dev/sample-invoices/baked/<dir>/extraction.json` for the seed to run.
 * Kept in sync with the `TARGET_PDFS` list in `bakeDemoFixtures.ts` and the
 * scenario rows in `buildScenarioRows` below.
 */
const DEMO_INVOICE_ATTACHMENT_NAMES = [
  "INV-FY2526-939.pdf",
  "FC-Airtel.pdf",
  "FC-Vector_.pdf",
  "FC-Focus_Bills.pdf",
  "DV-Robu IN.pdf",
  "FC-G4S Facility_.pdf"
] as const;

const MAHIR_EMAIL = "mahir.n@globalhealthx.co";
const MAHIR_AP_CLERK_EMAIL = "mahir-ap-clerk@neelam.test";
const MAHIR_SENIOR_ACCOUNTANT_EMAIL = "mahir-senior-accountant@neelam.test";

const NOW = new Date("2026-04-20T12:00:00Z");
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function contentHashFor(tenantId: string, attachmentName: string): string {
  return sha256Hex(`${tenantId}|${DEMO_SOURCE_KEY}|${attachmentName}`);
}

async function resolveTenantUserIds(): Promise<{
  mahirUserId: string;
  apClerkUserId: string | null;
  seniorAccountantUserId: string | null;
  tenantUserIds: string[];
}> {
  const mahir = await UserModel.findOne({ email: MAHIR_EMAIL }).lean();
  if (!mahir) {
    throw new Error(
      `Demo invoice seed: tenant owner '${MAHIR_EMAIL}' not found. Run the local demo seed first.`
    );
  }
  const apClerk = await UserModel.findOne({ email: MAHIR_AP_CLERK_EMAIL }).lean();
  const senior = await UserModel.findOne({ email: MAHIR_SENIOR_ACCOUNTANT_EMAIL }).lean();

  const tenantUserIds: string[] = [String(mahir._id)];
  if (apClerk) tenantUserIds.push(String(apClerk._id));
  if (senior) tenantUserIds.push(String(senior._id));

  return {
    mahirUserId: String(mahir._id),
    apClerkUserId: apClerk ? String(apClerk._id) : null,
    seniorAccountantUserId: senior ? String(senior._id) : null,
    tenantUserIds
  };
}

async function ensureSeedVendors(tenantId: string): Promise<void> {
  // Confirm the two vendors the risk/export scenarios rely on exist. Other
  // fixture invoices don't require a pre-seeded VendorMaster row.
  const sprinto = await VendorMasterModel.findOne({
    tenantId,
    vendorFingerprint: "sprinto-technology-private-limited"
  }).lean();
  if (!sprinto) {
    throw new Error(
      "Demo invoice seed: Sprinto vendor master not found. Ensure seedDemoTenantConfig has run first."
    );
  }
  const focus = await VendorMasterModel.findOne({
    tenantId,
    vendorFingerprint: "delta-engineering-works"
  }).lean();
  if (!focus) {
    throw new Error(
      "Demo invoice seed: Delta Engineering Works (MSME) vendor master not found. Ensure seedDemoTenantConfig has run first."
    );
  }
}

/* -------------------------------------------------------- fixture loader */

/**
 * Fixture shape as written by `bakeDemoFixtures.ts`. Tenant-specific overlay
 * fields (tenantId, status, workflowState, approval, compliance, export,
 * receivedAt) are NOT part of the fixture — the scenario overlay below adds
 * them. Dates are stored as ISO strings for JSON round-trip fidelity and are
 * converted back to Date on load.
 */
interface BakedFixture {
  sourceFilename: string;
  mimeType: "application/pdf";
  parsed: Record<string, unknown>;
  ocrBlocks: unknown[];
  fieldProvenance: Record<string, unknown>;
  lineItemProvenance: unknown[];
  extraction: Record<string, unknown>;
  confidenceScore: number;
  confidenceTone: ConfidenceTone;
  previewPageImages: Record<string, string>;
}

function fixtureDirFor(attachmentName: string): string {
  return attachmentName.replace(/\.pdf$/i, "").trim();
}

/**
 * Resolve `dev/sample-invoices/baked/` relative to the repo root regardless
 * of whether the seed is invoked with cwd=backend (yarn seed:demo-tenant),
 * cwd=<repo-root> (orchestration scripts), or via ts-jest (CommonJS).
 *
 * We anchor the path to this source file's on-disk location and walk up to
 * the repo root. Under CommonJS (ts-jest) the Node global `__dirname` is
 * defined; under native ESM (tsx / node --experimental-vm-modules) we fall
 * back to `import.meta.url`. Both yield the same absolute path. Jest can
 * still mock `existsSync`/`readFileSync` against the resulting absolute
 * path because the mock matches on the path suffix.
 */
function bakedFixturesDir(): string {
  // Resolve the baked-fixtures directory independently of cwd so the seed
  // works from the backend directory (yarn seed:demo-tenant) as well as the
  // repo root (orchestration). Strategy: start from cwd and walk upward
  // until we find a parent that contains `dev/sample-invoices/baked`; if
  // none, fall back to `<cwd>/dev/sample-invoices/baked` so the caller gets
  // a clear "missing fixtures" log pointing at their own tree.
  const target = join("dev", "sample-invoices", "baked");
  let cursor = process.cwd();
  for (let depth = 0; depth < 6; depth++) {
    const candidate = join(cursor, target);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return join(process.cwd(), target);
}

function loadFixture(attachmentName: string): BakedFixture {
  const dir = fixtureDirFor(attachmentName);
  const fixturePath = join(bakedFixturesDir(), dir, "extraction.json");
  const raw = JSON.parse(readFileSync(fixturePath, "utf-8")) as BakedFixture;
  // Revive Date fields that live inside parsed.
  for (const key of ["invoiceDate", "dueDate"] as const) {
    const value = raw.parsed[key];
    if (typeof value === "string" && value.trim().length > 0) {
      raw.parsed[key] = new Date(value);
    }
  }
  return raw;
}

function readPreviewBytes(attachmentName: string, page: string): Buffer {
  const dir = fixtureDirFor(attachmentName);
  const pngPath = join(bakedFixturesDir(), dir, `preview-page-${page}.png`);
  return readFileSync(pngPath);
}

/* -------------------------------------------------------- scenario overlay */

type InvoiceSeedRiskSignal = Omit<ComplianceRiskSignal, "resolvedBy" | "resolvedAt">;

interface ScenarioRow {
  attachmentName: string;
  status: string;
  receivedAt: Date;
  workflowState?: InvoiceWorkflowState;
  export?: InvoiceExport;
  riskSignals?: InvoiceSeedRiskSignal[];
  approval?: {
    approvedBy?: string;
    approvedAt?: Date;
    userId?: string;
    email?: string;
    role?: string;
  };
}

function buildScenarioRows(params: {
  mahirUserId: string;
  apClerkUserId: string | null;
  seniorAccountantUserId: string | null;
  workflowId: string | null;
  exportBatchId: string;
}): ScenarioRow[] {
  const { mahirUserId, apClerkUserId, seniorAccountantUserId, workflowId, exportBatchId } = params;
  const _apApprover = apClerkUserId ?? mahirUserId;
  const seniorApprover = seniorAccountantUserId ?? mahirUserId;
  const safeWorkflowId = workflowId ?? "demo-workflow";

  return [
    // #1 — EXPORTED, full 4-step approval, export.batchId references seeded batch
    {
      attachmentName: "INV-FY2526-939.pdf",
      status: INVOICE_STATUS.EXPORTED,
      receivedAt: daysAgo(10),
      approval: {
        approvedBy: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
        approvedAt: daysAgo(6),
        userId: seniorApprover,
        email: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
        role: "senior_accountant"
      },
      workflowState: {
        workflowId: safeWorkflowId,
        currentStep: 0,
        status: "approved",
        stepResults: [
          { step: 1, name: "Manager review", action: "approved", userId: seniorApprover, email: MAHIR_SENIOR_ACCOUNTANT_EMAIL, role: "senior_accountant", timestamp: daysAgo(8) },
          { step: 2, name: "Compliance sign-off", action: "approved", userId: mahirUserId, email: MAHIR_EMAIL, role: "TENANT_ADMIN", timestamp: daysAgo(7) },
          { step: 3, name: "Risk review", action: "skipped", timestamp: daysAgo(7), note: "Condition not met" },
          { step: 4, name: "CFO escalation", action: "skipped", timestamp: daysAgo(7), note: "Condition not met" }
        ]
      },
      export: {
        system: DEMO_EXPORT_SYSTEM,
        batchId: exportBatchId,
        exportedAt: daysAgo(5),
        externalReference: "TALLY-REF-INV-FY2526-939"
      }
    },

    // #2 — APPROVED, 1-step workflow finished, no export
    {
      attachmentName: "FC-Airtel.pdf",
      status: INVOICE_STATUS.APPROVED,
      receivedAt: daysAgo(4),
      approval: {
        approvedBy: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
        approvedAt: daysAgo(2),
        userId: seniorApprover,
        email: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
        role: "senior_accountant"
      },
      workflowState: {
        workflowId: safeWorkflowId,
        currentStep: 1,
        status: "approved",
        stepResults: [
          { step: 1, name: "Manager review", action: "approved", userId: seniorApprover, email: MAHIR_SENIOR_ACCOUNTANT_EMAIL, role: "senior_accountant", timestamp: daysAgo(2) }
        ]
      }
    },

    // #3 — AWAITING_APPROVAL at step 2 (compliance sign-off pending;
    // seed places the invoice at step 2 regardless of the fixture's extracted
    // amount — workflow rules govern auto-advancement, not placement).
    {
      attachmentName: "FC-Vector_.pdf",
      status: INVOICE_STATUS.AWAITING_APPROVAL,
      receivedAt: daysAgo(3),
      workflowState: {
        workflowId: safeWorkflowId,
        currentStep: 2,
        status: "in_progress",
        stepResults: [
          { step: 1, name: "Manager review", action: "approved", userId: seniorApprover, email: MAHIR_SENIOR_ACCOUNTANT_EMAIL, role: "senior_accountant", timestamp: daysAgo(1) }
        ]
      }
    },

    // #4 — NEEDS_REVIEW with two risk signals (MSME + above-expected), no workflow state
    {
      attachmentName: "FC-Focus_Bills.pdf",
      status: INVOICE_STATUS.NEEDS_REVIEW,
      receivedAt: daysAgo(2),
      riskSignals: [
        {
          code: "MSME_PAYMENT_DUE_SOON",
          category: "compliance",
          severity: "warning",
          message: "MSME vendor payment deadline within 5 days — MSMED Act window closing.",
          confidencePenalty: 10,
          status: "open"
        },
        {
          code: "TOTAL_AMOUNT_ABOVE_EXPECTED",
          category: "financial",
          severity: "warning",
          message: "Invoice total is 2.5x the rolling 6-month vendor average.",
          confidencePenalty: 15,
          status: "open"
        }
      ]
    },

    // #5 — PARSED, fresh, nothing pending
    {
      attachmentName: "DV-Robu IN.pdf",
      status: INVOICE_STATUS.PARSED,
      receivedAt: daysAgo(1)
    },

    // #6 — AWAITING_APPROVAL but rejected at step 1
    {
      attachmentName: "FC-G4S Facility_.pdf",
      status: INVOICE_STATUS.AWAITING_APPROVAL,
      receivedAt: daysAgo(3),
      workflowState: {
        workflowId: safeWorkflowId,
        currentStep: 1,
        status: "rejected",
        stepResults: [
          { step: 1, name: "Manager review", action: "rejected", userId: seniorApprover, email: MAHIR_SENIOR_ACCOUNTANT_EMAIL, role: "senior_accountant", timestamp: daysAgo(1), note: "Scope mismatch — returned to AP" }
        ]
      }
    }
  ];
}

/* -------------------------------------------------------- preview upload */

interface PreviewUploadDeps {
  fileStore?: FileStore;
}

async function uploadPreviewsForInvoice(
  attachmentName: string,
  sourceDocumentId: string,
  fixture: BakedFixture,
  deps: PreviewUploadDeps
): Promise<Record<string, string>> {
  const previewKeyMap: Record<string, string> = {};
  const pages = Object.keys(fixture.previewPageImages);
  if (pages.length === 0 || !deps.fileStore) {
    return previewKeyMap;
  }

  for (const page of pages) {
    const key = `demo-seed/${sourceDocumentId}/preview-page-${page}.png`;
    // Overwrite semantics — putObject replaces any prior seeded artifact at
    // the same key, so re-runs remain idempotent without an explicit delete.
    const bytes = readPreviewBytes(attachmentName, page);
    const ref = await deps.fileStore.putObject({
      key,
      body: bytes,
      contentType: "image/png",
      metadata: { sourceKey: DEMO_SOURCE_KEY, sourceDocumentId }
    });
    previewKeyMap[page] = ref.path;
  }

  return previewKeyMap;
}

/* -------------------------------------------------------- invoice builder */

interface SeedRecord {
  tenantId: string;
  clientOrgId: Types.ObjectId;
  workloadTier: "standard";
  sourceType: "upload";
  sourceKey: typeof DEMO_SOURCE_KEY;
  sourceDocumentId: string;
  attachmentName: string;
  contentHash: string;
  mimeType: "application/pdf";
  receivedAt: Date;
  status: string;
  confidenceScore: number;
  confidenceTone: ConfidenceTone;
  parsed: Record<string, unknown>;
  ocrBlocks: unknown[];
  extraction: Record<string, unknown>;
  metadata: Record<string, string>;
  workflowState?: InvoiceWorkflowState;
  export?: InvoiceExport;
  compliance?: { riskSignals: InvoiceSeedRiskSignal[] };
  approval?: Record<string, unknown>;
  processingIssues: string[];
}

function toInvoiceDoc(
  row: ScenarioRow,
  fixture: BakedFixture,
  tenantId: string,
  clientOrgId: Types.ObjectId,
  batchId: string,
  previewKeyMap: Record<string, string>
): SeedRecord {
  const sourceDocumentId = row.attachmentName;

  const metadata: Record<string, string> = {
    extractionSource: String(fixture.extraction.source ?? ""),
    extractionStrategy: String(fixture.extraction.strategy ?? ""),
    ocrBlocksCount: String(fixture.ocrBlocks.length)
  };
  if (Object.keys(previewKeyMap).length > 0) {
    metadata.previewPageImages = JSON.stringify(previewKeyMap);
  }

  // Mongoose Map keys reject `.` because it collides with path syntax, so
  // the live ingestion pipeline (see services/ingestion/provenance.ts)
  // encodes dotted nested field keys (e.g. `gst.cessMinor`) to `__dot__`
  // before storage. The baked fixture retains the raw dotted keys so the
  // JSON reads naturally on disk; we apply the same encoding here at seed
  // time to match ingestion parity.
  const encodeDot = (key: string): string => key.replace(/\./g, "__dot__");
  const encodedFieldProvenance = Object.fromEntries(
    Object.entries(fixture.fieldProvenance).map(([k, v]) => [encodeDot(k), v])
  );
  const rawFieldConfidence = (fixture.extraction.fieldConfidence ?? {}) as Record<string, unknown>;
  const encodedFieldConfidence = Object.fromEntries(
    Object.entries(rawFieldConfidence).map(([k, v]) => [encodeDot(k), v])
  );
  const extractionForInvoice: Record<string, unknown> = {
    ...fixture.extraction,
    fieldConfidence: encodedFieldConfidence,
    fieldProvenance: encodedFieldProvenance,
    lineItemProvenance: fixture.lineItemProvenance
  };

  const doc: SeedRecord = {
    tenantId,
    clientOrgId,
    workloadTier: "standard",
    sourceType: "upload",
    sourceKey: DEMO_SOURCE_KEY,
    sourceDocumentId,
    attachmentName: row.attachmentName,
    contentHash: contentHashFor(tenantId, row.attachmentName),
    mimeType: "application/pdf",
    receivedAt: row.receivedAt,
    status: row.status,
    confidenceScore: fixture.confidenceScore,
    confidenceTone: fixture.confidenceTone,
    parsed: fixture.parsed,
    ocrBlocks: fixture.ocrBlocks,
    extraction: extractionForInvoice,
    metadata,
    processingIssues: []
  };

  if (row.workflowState) doc.workflowState = row.workflowState;
  if (row.export) doc.export = { ...row.export, batchId };
  if (row.riskSignals && row.riskSignals.length > 0) {
    doc.compliance = { riskSignals: row.riskSignals };
  }
  if (row.approval) doc.approval = row.approval;

  return doc;
}

/* -------------------------------------------------------- entrypoint */

interface SeedDemoInvoicesOptions {
  fileStore?: FileStore;
}

/**
 * Seed a deterministic set of demo invoices + 1 export batch + 3 mailbox
 * notification events for the Neelam and Associates demo tenant.
 *
 * Every seeded invoice + the seeded export batch belong to the same
 * `clientOrgId` (Global Innovation Hub Private Limited) — the realm that
 * matches the customer entity on the baked Sprinto invoice. Per the Part-2
 * locked decisions, accounting-leaf docs require both `{tenantId, clientOrgId}`
 * — the demo seed is the only path that auto-creates a ClientOrg, and the
 * caller passes its `_id` here.
 *
 * Parsed invoice content, OCR blocks, field provenance, and preview-page PNGs
 * come from pre-baked fixtures in `dev/sample-invoices/baked/<dir>/`, captured
 * once via `yarn bake:demo-fixtures`. The scenario overlay (status, workflow,
 * approval, risk signals, export) is applied per row.
 *
 * Fixture-absent behavior: if any of the 6 expected `extraction.json` files
 * is missing, this function logs a warning and returns early without throwing
 * and without partially seeding. This keeps the backend boot path healthy on
 * fresh checkouts where baked fixtures haven't been generated yet. Running
 * `yarn bake:demo-fixtures` with `LLAMA_CLOUD_API_KEY` set is a one-time dev
 * step — the generated artifacts are committed and survive between deploys.
 *
 * Idempotent: every insert is preceded by a scoped deleteMany keyed on the
 * demo-seed markers (`sourceKey` for invoices, `system` for export batches,
 * `reason: /^demo-seed:/` for notification events), so re-running leaves the
 * tenant in an identical state. Preview PNGs overwrite on put.
 */
export async function seedDemoInvoices(
  tenantId: string,
  clientOrgId: Types.ObjectId,
  options: SeedDemoInvoicesOptions = {}
): Promise<void> {
  logger.info("demo.seed.invoices.start", { tenantId, clientOrgId: String(clientOrgId) });

  // Precondition: all 6 baked fixtures must exist on disk. If any are missing
  // we skip silently (with a warning) rather than throw, so the backend can
  // boot cleanly on fresh checkouts before `yarn bake:demo-fixtures` has run.
  const missing: string[] = [];
  for (const name of DEMO_INVOICE_ATTACHMENT_NAMES) {
    const fixturePath = join(bakedFixturesDir(), fixtureDirFor(name), "extraction.json");
    if (!existsSync(fixturePath)) {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    logger.warn("demo.seed.invoices.skipped", {
      reason: "baked-fixtures-absent",
      missing,
      fix: "Run 'yarn bake:demo-fixtures' with LLAMA_CLOUD_API_KEY to generate fixtures"
    });
    return;
  }

  const { mahirUserId, apClerkUserId, seniorAccountantUserId, tenantUserIds } = await resolveTenantUserIds();
  await ensureSeedVendors(tenantId);

  const workflow = await ApprovalWorkflowModel.findOne({ tenantId }).select({ _id: 1 }).lean();
  const workflowId = workflow ? String(workflow._id) : null;

  await InvoiceModel.deleteMany({ tenantId, sourceKey: DEMO_SOURCE_KEY });

  await ExportBatchModel.deleteMany({ tenantId, system: DEMO_EXPORT_SYSTEM });
  const batch = await ExportBatchModel.create({
    tenantId,
    clientOrgId,
    system: DEMO_EXPORT_SYSTEM,
    total: 1,
    successCount: 1,
    failureCount: 0,
    requestedBy: mahirUserId,
    fileKey: "demo-seed/export-batch-INV-FY2526-939"
  });
  const exportBatchId = String(batch._id);

  const rows = buildScenarioRows({
    mahirUserId,
    apClerkUserId,
    seniorAccountantUserId,
    workflowId,
    exportBatchId
  });

  const docs: SeedRecord[] = [];
  for (const row of rows) {
    const fixture = loadFixture(row.attachmentName);
    const previewKeyMap = await uploadPreviewsForInvoice(
      row.attachmentName,
      row.attachmentName,
      fixture,
      options
    );
    docs.push(toInvoiceDoc(row, fixture, tenantId, clientOrgId, exportBatchId, previewKeyMap));
  }

  if (docs.length > 0) {
    await InvoiceModel.insertMany(docs, { ordered: true });
  }

  await MailboxNotificationEventModel.deleteMany({
    userId: { $in: tenantUserIds },
    reason: { $regex: /^demo-seed:/ }
  });

  const notificationDocs: Array<Record<string, unknown>> = [];
  if (apClerkUserId) {
    notificationDocs.push({
      userId: apClerkUserId,
      provider: "gmail",
      emailAddress: MAHIR_AP_CLERK_EMAIL,
      eventType: "mailbox_reauth_required",
      reason: `${DEMO_NOTIFICATION_REASON_PREFIX}mailbox_reauth`,
      delivered: true,
      retryCount: 0,
      deliveryFailed: false,
      recipient: MAHIR_AP_CLERK_EMAIL,
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1)
    });
  }
  if (seniorAccountantUserId) {
    notificationDocs.push({
      userId: seniorAccountantUserId,
      provider: "gmail",
      emailAddress: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
      eventType: "escalation",
      reason: `${DEMO_NOTIFICATION_REASON_PREFIX}escalation_failed`,
      delivered: false,
      retryCount: 3,
      deliveryFailed: true,
      failureReason: "SMTP timeout after 3 retries",
      recipient: MAHIR_SENIOR_ACCOUNTANT_EMAIL,
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2)
    });
  }
  notificationDocs.push({
    userId: mahirUserId,
    provider: "gmail",
    emailAddress: MAHIR_EMAIL,
    eventType: "escalation",
    reason: `${DEMO_NOTIFICATION_REASON_PREFIX}escalation_skipped_dry_run`,
    delivered: false,
    retryCount: 0,
    deliveryFailed: false,
    skippedReason: "Dry-run mode — escalation suppressed",
    recipient: MAHIR_EMAIL,
    createdAt: daysAgo(3),
    updatedAt: daysAgo(3)
  });

  if (notificationDocs.length > 0) {
    await MailboxNotificationEventModel.insertMany(notificationDocs, { ordered: true });
  }

  logger.info("demo.seed.invoices.complete", {
    tenantId,
    clientOrgId: String(clientOrgId),
    invoices: docs.length,
    exportBatches: 1,
    notifications: notificationDocs.length,
    fileStoreAttached: Boolean(options.fileStore)
  });
}
