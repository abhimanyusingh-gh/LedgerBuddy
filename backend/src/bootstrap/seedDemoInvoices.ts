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

const DEMO_SOURCE_KEY = "demo-seed";
const DEMO_EXPORT_SYSTEM = "demo-seed";
const DEMO_NOTIFICATION_REASON_PREFIX = "demo-seed:";

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

function bakedFixturesDir(): string {
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

    {
      attachmentName: "DV-Robu IN.pdf",
      status: INVOICE_STATUS.PARSED,
      receivedAt: daysAgo(1)
    },

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

interface SeedDemoInvoicesOptions {
  fileStore?: FileStore;
}

export async function seedDemoInvoices(
  tenantId: string,
  clientOrgId: Types.ObjectId,
  options: SeedDemoInvoicesOptions = {}
): Promise<void> {
  logger.info("demo.seed.invoices.start", { tenantId, clientOrgId: String(clientOrgId) });

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
