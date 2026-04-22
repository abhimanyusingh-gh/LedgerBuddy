import { createHash } from "node:crypto";
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

interface VendorLookup {
  sprinto: string;
  airtel?: string | null;
  ait?: string | null;
  focus: string;
  robu?: string | null;
  g4s?: string | null;
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

async function resolveVendorIds(tenantId: string): Promise<VendorLookup> {
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

  return {
    sprinto: String(sprinto._id),
    focus: String(focus._id)
  };
}

type InvoiceSeedRiskSignal = Omit<ComplianceRiskSignal, "resolvedBy" | "resolvedAt">;

interface InvoiceSeed {
  attachmentName: string;
  vendorName: string;
  vendorFingerprint: string;
  totalAmountMinor: number;
  status: string;
  workflowState?: InvoiceWorkflowState;
  export?: InvoiceExport;
  riskSignals?: InvoiceSeedRiskSignal[];
  parsedOverrides?: Record<string, unknown>;
  extraction?: Record<string, unknown>;
  approval?: { approvedBy?: string; approvedAt?: Date; userId?: string; email?: string; role?: string };
  confidenceScore?: number;
  confidenceTone?: ConfidenceTone;
  receivedAt: Date;
}

function buildSprintoParsed(): Record<string, unknown> {
  // Values mirror dev/sample-invoices/ground-truth.json for INV-FY2526-939 so
  // the seeded document matches what the extraction pipeline would produce.
  return {
    invoiceNumber: "INV-FY2526-939",
    vendorName: "Sprinto Technology Private Limited",
    vendorAddress: "Bannerghatta Main Rd, Bengaluru, Karnataka 560076",
    vendorGstin: "29ABCCS8316F1Z7",
    vendorPan: "ABCCS8316F",
    customerName: "Global Innovation Hub",
    customerAddress: "Sanali Spazio, Hitech City, Hyderabad, Telangana 500081",
    customerGstin: null,
    invoiceDate: new Date("2026-03-15T00:00:00Z"),
    dueDate: new Date("2026-03-22T00:00:00Z"),
    totalAmountMinor: 11151000,
    currency: "INR",
    gst: {
      gstin: "29ABCCS8316F1Z7",
      subtotalMinor: 9450000,
      cgstMinor: 850500,
      sgstMinor: 850500,
      igstMinor: 0,
      cessMinor: 0,
      totalTaxMinor: 1701000
    },
    pan: "ABCCS8316F",
    lineItems: [
      { description: "Compliance automation subscription — Starter", amountMinor: 1575000, quantity: 1, rate: 15750 },
      { description: "Compliance automation subscription — Growth", amountMinor: 7875000, quantity: 1, rate: 78750 }
    ]
  };
}

function buildSprintoExtraction(): Record<string, unknown> {
  return {
    source: "llamaparse",
    strategy: "agentic",
    invoiceType: "TAX_INVOICE",
    fieldProvenance: {
      invoiceNumber: { page: 1, bboxNormalized: [0.2879, 0.2048, 0.3976, 0.2132], confidence: 0.97 },
      vendorName: { page: 1, bboxNormalized: [0.0766, 0.5579, 0.4036, 0.5676], confidence: 0.95 },
      invoiceDate: { page: 1, bboxNormalized: [0.0741, 0.2052, 0.3717, 0.2537], confidence: 0.94 },
      dueDate: { page: 1, bboxNormalized: [0.0741, 0.2182, 0.3717, 0.2537], confidence: 0.92 },
      totalAmountMinor: { page: 1, bboxNormalized: [0.8531, 0.481, 0.9422, 0.5503], confidence: 0.96 },
      vendorAddress: { page: 1, bboxNormalized: [0.2945, 0.1055, 0.5252, 0.1478], confidence: 0.9 },
      vendorGstin: { page: 1, bboxNormalized: [0.2945, 0.1494, 0.4523, 0.1589], confidence: 0.95 },
      customerName: { page: 1, bboxNormalized: [0.0736, 0.2968, 0.3492, 0.3067], confidence: 0.92 },
      customerAddress: { page: 1, bboxNormalized: [0.0741, 0.3119, 0.2874, 0.3215], confidence: 0.89 }
    }
  };
}

function buildInvoiceSeeds(params: {
  vendors: VendorLookup;
  mahirUserId: string;
  apClerkUserId: string | null;
  seniorAccountantUserId: string | null;
  workflowId: string | null;
  exportBatchId: string;
}): InvoiceSeed[] {
  const { mahirUserId, apClerkUserId, seniorAccountantUserId, workflowId, exportBatchId } = params;
  const approver = apClerkUserId ?? mahirUserId;
  const seniorApprover = seniorAccountantUserId ?? mahirUserId;
  const safeWorkflowId = workflowId ?? "demo-workflow";

  return [
    // #1 — EXPORTED, full 4-step approval, export.batchId references seeded batch
    {
      attachmentName: "INV-FY2526-939.pdf",
      vendorName: "Sprinto Technology Private Limited",
      vendorFingerprint: "sprinto-technology-private-limited",
      totalAmountMinor: 11151000,
      status: INVOICE_STATUS.EXPORTED,
      receivedAt: daysAgo(10),
      confidenceScore: 92,
      confidenceTone: "green",
      parsedOverrides: buildSprintoParsed(),
      extraction: buildSprintoExtraction(),
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
      vendorName: "Airtel",
      vendorFingerprint: "airtel",
      totalAmountMinor: 250000,
      status: INVOICE_STATUS.APPROVED,
      receivedAt: daysAgo(4),
      confidenceScore: 88,
      confidenceTone: "green",
      parsedOverrides: {
        invoiceNumber: "AIRTEL-2026-03-001",
        vendorName: "Airtel",
        invoiceDate: new Date("2026-03-20T00:00:00Z"),
        dueDate: new Date("2026-04-10T00:00:00Z"),
        totalAmountMinor: 250000,
        currency: "INR"
      },
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

    // #3 — AWAITING_APPROVAL at step 2 (compliance sign-off triggers since amount > 5,000,000)
    {
      attachmentName: "FC-AIT_563.pdf",
      vendorName: "AIT Solutions",
      vendorFingerprint: "ait-solutions",
      totalAmountMinor: 15000000,
      status: INVOICE_STATUS.AWAITING_APPROVAL,
      receivedAt: daysAgo(3),
      confidenceScore: 81,
      confidenceTone: "yellow",
      parsedOverrides: {
        invoiceNumber: "AIT-563",
        vendorName: "AIT Solutions",
        invoiceDate: new Date("2026-03-25T00:00:00Z"),
        dueDate: new Date("2026-04-24T00:00:00Z"),
        totalAmountMinor: 15000000,
        currency: "INR"
      },
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
      vendorName: "Delta Engineering Works",
      vendorFingerprint: "delta-engineering-works",
      totalAmountMinor: 750000,
      status: INVOICE_STATUS.NEEDS_REVIEW,
      receivedAt: daysAgo(2),
      confidenceScore: 55,
      confidenceTone: "red",
      parsedOverrides: {
        invoiceNumber: "FB-2026-04-007",
        vendorName: "Delta Engineering Works",
        invoiceDate: new Date("2026-03-28T00:00:00Z"),
        dueDate: new Date("2026-04-22T00:00:00Z"),
        totalAmountMinor: 750000,
        currency: "INR"
      },
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
      vendorName: "Robu.in",
      vendorFingerprint: "robu-in",
      totalAmountMinor: 180000,
      status: INVOICE_STATUS.PARSED,
      receivedAt: daysAgo(1),
      confidenceScore: 86,
      confidenceTone: "green",
      parsedOverrides: {
        invoiceNumber: "ROBU-2026-00241",
        vendorName: "Robu.in",
        invoiceDate: new Date("2026-04-15T00:00:00Z"),
        dueDate: new Date("2026-05-15T00:00:00Z"),
        totalAmountMinor: 180000,
        currency: "INR"
      }
    },

    // #6 — AWAITING_APPROVAL but rejected at step 1
    {
      attachmentName: "FC-G4S Facility_.pdf",
      vendorName: "G4S Facility",
      vendorFingerprint: "g4s-facility",
      totalAmountMinor: 38000000,
      status: INVOICE_STATUS.AWAITING_APPROVAL,
      receivedAt: daysAgo(3),
      confidenceScore: 74,
      confidenceTone: "yellow",
      parsedOverrides: {
        invoiceNumber: "G4S-FAC-FY26-0118",
        vendorName: "G4S Facility",
        invoiceDate: new Date("2026-03-30T00:00:00Z"),
        dueDate: new Date("2026-04-29T00:00:00Z"),
        totalAmountMinor: 38000000,
        currency: "INR"
      },
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

interface SeedRecord {
  tenantId: string;
  workloadTier: "standard";
  sourceType: "folder";
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
  extraction?: Record<string, unknown>;
  workflowState?: InvoiceWorkflowState;
  export?: InvoiceExport;
  compliance?: { riskSignals: InvoiceSeedRiskSignal[] };
  approval?: Record<string, unknown>;
  processingIssues: string[];
}

function toInvoiceDoc(seed: InvoiceSeed, tenantId: string, batchId: string): SeedRecord {
  const parsed: Record<string, unknown> = {
    currency: "INR",
    ...(seed.parsedOverrides ?? {}),
    totalAmountMinor: seed.totalAmountMinor,
    vendorName: seed.vendorName
  };

  const doc: SeedRecord = {
    tenantId,
    workloadTier: "standard",
    sourceType: "folder",
    sourceKey: DEMO_SOURCE_KEY,
    sourceDocumentId: seed.attachmentName,
    attachmentName: seed.attachmentName,
    contentHash: contentHashFor(tenantId, seed.attachmentName),
    mimeType: "application/pdf",
    receivedAt: seed.receivedAt,
    status: seed.status,
    confidenceScore: seed.confidenceScore ?? 0,
    confidenceTone: seed.confidenceTone ?? "red",
    parsed,
    processingIssues: []
  };

  if (seed.extraction) doc.extraction = seed.extraction;
  if (seed.workflowState) doc.workflowState = seed.workflowState;
  if (seed.export) doc.export = { ...seed.export, batchId };
  if (seed.riskSignals && seed.riskSignals.length > 0) {
    doc.compliance = { riskSignals: seed.riskSignals };
  }
  if (seed.approval) doc.approval = seed.approval;

  return doc;
}

/**
 * Seed a deterministic set of demo invoices + 1 export batch + 3 mailbox
 * notification events for the Neelam and Associates demo tenant.
 *
 * Idempotent: every insert is preceded by a scoped deleteMany keyed on the
 * demo-seed markers (`sourceKey` for invoices, `system` for export batches,
 * `reason: /^demo-seed:/` for notification events), so re-running leaves the
 * tenant in an identical state.
 */
export async function seedDemoInvoices(tenantId: string): Promise<void> {
  logger.info("demo.seed.invoices.start", { tenantId });

  const { mahirUserId, apClerkUserId, seniorAccountantUserId, tenantUserIds } = await resolveTenantUserIds();
  const vendors = await resolveVendorIds(tenantId);

  const workflow = await ApprovalWorkflowModel.findOne({ tenantId }).select({ _id: 1 }).lean();
  const workflowId = workflow ? String(workflow._id) : null;

  await InvoiceModel.deleteMany({ tenantId, sourceKey: DEMO_SOURCE_KEY });

  await ExportBatchModel.deleteMany({ tenantId, system: DEMO_EXPORT_SYSTEM });
  const batch = await ExportBatchModel.create({
    tenantId,
    system: DEMO_EXPORT_SYSTEM,
    total: 1,
    successCount: 1,
    failureCount: 0,
    requestedBy: mahirUserId,
    fileKey: "demo-seed/export-batch-INV-FY2526-939"
  });
  const exportBatchId = String(batch._id);

  const seeds = buildInvoiceSeeds({
    vendors,
    mahirUserId,
    apClerkUserId,
    seniorAccountantUserId,
    workflowId,
    exportBatchId
  });
  const docs = seeds.map((s) => toInvoiceDoc(s, tenantId, exportBatchId));
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
    invoices: docs.length,
    exportBatches: 1,
    notifications: notificationDocs.length
  });
}
