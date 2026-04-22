import { TenantUserRoleModel } from "@/models/core/TenantUserRole.js";
import { UserModel } from "@/models/core/User.js";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
import { TenantNotificationConfigModel } from "@/models/integration/TenantNotificationConfig.js";
import { TenantExportConfigModel } from "@/models/integration/TenantExportConfig.js";
import { VendorMasterModel } from "@/models/compliance/VendorMaster.js";
import { ApprovalWorkflowService } from "@/services/invoice/approvalWorkflowService.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";
import { logger } from "@/utils/logger.js";

const SEED_UPDATED_BY = "seed:demo-tenant";

// Copied from routes/compliance/tenantComplianceConfig.ts (DEFAULT_TDS_SECTIONS). Kept as a
// local constant to avoid importing from the HTTP route module into a bootstrap helper.
const DEFAULT_TDS_SECTIONS = [
  { section: "194C", description: "Contractor payments", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 3000000, active: true },
  { section: "194J", description: "Professional/Technical fees", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 3000000, active: true },
  { section: "194H", description: "Commission/Brokerage", rateIndividual: 500, rateCompany: 500, rateNoPan: 2000, threshold: 1500000, active: true },
  { section: "194I(a)", description: "Rent - Plant & Machinery", rateIndividual: 200, rateCompany: 200, rateNoPan: 2000, threshold: 24000000, active: true },
  { section: "194I(b)", description: "Rent - Land/Building/Furniture", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 24000000, active: true },
  { section: "194A", description: "Interest other than securities", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 500000, active: true },
  { section: "194Q", description: "Purchase of goods", rateIndividual: 10, rateCompany: 10, rateNoPan: 500, threshold: 500000000, active: true }
];

const DEMO_TDS_OVERRIDES: Record<string, {
  description: string;
  rateIndividual: number;
  rateCompany: number;
  rateNoPan: number;
  threshold: number;
}> = {
  "194C": { description: "Contractor payments", rateIndividual: 100, rateCompany: 200, rateNoPan: 2000, threshold: 3000000 },
  "194J": { description: "Professional fees", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 3000000 },
  "194I(b)": { description: "Rent - Land/Building", rateIndividual: 1000, rateCompany: 1000, rateNoPan: 2000, threshold: 24000000 }
};

function buildDemoTdsRates() {
  return DEFAULT_TDS_SECTIONS.map((entry) => {
    const override = DEMO_TDS_OVERRIDES[entry.section];
    if (!override) return { ...entry };
    return { ...entry, ...override, active: true };
  });
}

/**
 * Minimal slug: lowercase, collapse non-alphanumeric runs to "-", trim leading/trailing "-".
 * Used for deriving a deterministic `vendorFingerprint` from a vendor name.
 */
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function seedComplianceConfig(tenantId: string): Promise<void> {
  const activeSignals = [
    RISK_SIGNAL_CODE.TOTAL_AMOUNT_ABOVE_EXPECTED,
    RISK_SIGNAL_CODE.DUE_DATE_TOO_FAR,
    RISK_SIGNAL_CODE.MISSING_MANDATORY_FIELDS,
    RISK_SIGNAL_CODE.DUPLICATE_INVOICE_NUMBER,
    RISK_SIGNAL_CODE.VENDOR_BANK_CHANGED,
    RISK_SIGNAL_CODE.PAN_FORMAT_INVALID,
    RISK_SIGNAL_CODE.PAN_GSTIN_MISMATCH,
    RISK_SIGNAL_CODE.MSME_PAYMENT_OVERDUE,
    RISK_SIGNAL_CODE.MSME_PAYMENT_DUE_SOON,
    RISK_SIGNAL_CODE.SENDER_FREEMAIL
  ];

  await TenantComplianceConfigModel.findOneAndUpdate(
    { tenantId },
    {
      $set: {
        tenantId,
        complianceEnabled: true,
        autoSuggestGlCodes: true,
        autoDetectTds: true,
        tdsEnabled: true,
        tdsRates: buildDemoTdsRates(),
        defaultTdsSection: "194J",
        panValidationEnabled: true,
        panValidationLevel: "format_and_checksum",
        riskSignalsEnabled: true,
        activeRiskSignals: activeSignals,
        disabledSignals: [],
        signalSeverityOverrides: { DUE_DATE_TOO_FAR: "warning" },
        maxInvoiceTotalMinor: 500000000,
        maxDueDays: 180,
        autoApprovalThreshold: 85,
        eInvoiceThresholdMinor: 500000000,
        msmePaymentWarningDays: 7,
        msmePaymentOverdueDays: 45,
        minimumExpectedTotalMinor: 10000,
        riskSignalPenaltyCap: 30,
        ocrWeight: 0.7,
        completenessWeight: 0.3,
        warningPenalty: 5,
        warningPenaltyCap: 20,
        requiredFields: ["invoiceNumber", "vendorName", "invoiceDate", "totalAmountMinor", "vendorGstin"],
        confidencePenaltyOverrides: { lineItems: 10, vendorGstin: 15 },
        reconciliationAutoMatchThreshold: 90,
        reconciliationSuggestThreshold: 70,
        reconciliationAmountToleranceMinor: 100,
        invoiceDateWindowDays: 30,
        defaultCurrency: "INR",
        approvalLimitOverrides: {},
        additionalFreemailDomains: ["outlook.in"],
        learningMode: "active",
        reconciliationWeightExactAmount: 60,
        reconciliationWeightCloseAmount: 15,
        reconciliationWeightInvoiceNumber: 35,
        reconciliationWeightVendorName: 25,
        reconciliationWeightDateProximity: 15,
        updatedBy: SEED_UPDATED_BY
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seedTcsConfig(tenantId: string, mahirUserId: string): Promise<void> {
  const history = [
    {
      previousRate: 0.075,
      newRate: 0.1,
      changedBy: mahirUserId,
      changedByName: "mahir.n@globalhealthx.co",
      changedAt: new Date("2026-04-01T00:00:00Z"),
      reason: "FY26 budget revision",
      effectiveFrom: new Date("2026-01-01T00:00:00Z")
    },
    {
      previousRate: 0.05,
      newRate: 0.075,
      changedBy: mahirUserId,
      changedByName: "mahir.n@globalhealthx.co",
      changedAt: new Date("2026-01-01T00:00:00Z"),
      reason: "Q4 update",
      effectiveFrom: new Date("2025-10-01T00:00:00Z")
    }
  ];

  await TenantTcsConfigModel.findOneAndUpdate(
    { tenantId },
    {
      $set: {
        tenantId,
        ratePercent: 0.1,
        effectiveFrom: new Date("2026-04-01T00:00:00Z"),
        enabled: true,
        tcsModifyRoles: ["TENANT_ADMIN", "ca"],
        history,
        updatedBy: SEED_UPDATED_BY
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seedNotificationConfig(tenantId: string, mahirUserId: string): Promise<void> {
  await TenantNotificationConfigModel.findOneAndUpdate(
    { tenantId },
    {
      $set: {
        tenantId,
        mailboxReauthEnabled: true,
        escalationEnabled: true,
        inAppEnabled: true,
        primaryRecipientType: "specific_user",
        specificRecipientUserId: mahirUserId,
        updatedBy: SEED_UPDATED_BY
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function seedExportConfig(tenantId: string): Promise<void> {
  const csvColumns = [
    { key: "invoiceNumber", label: "Invoice #" },
    { key: "vendorName", label: "Vendor" },
    { key: "invoiceDate", label: "Date" },
    { key: "total", label: "Amount" },
    { key: "currency", label: "CCY" },
    { key: "glCode", label: "GL" },
    { key: "tdsSection", label: "TDS Sec" },
    { key: "tdsAmount", label: "TDS \u20B9" },
    { key: "cgst", label: "CGST" },
    { key: "sgst", label: "SGST" },
    { key: "igst", label: "IGST" },
    { key: "pan", label: "PAN" },
    { key: "gstin", label: "GSTIN" }
  ];

  await TenantExportConfigModel.findOneAndUpdate(
    { tenantId },
    {
      $set: {
        tenantId,
        tallyCompanyName: "Neelam and Associates",
        tallyPurchaseLedger: "Purchases A/c",
        tallyCgstLedger: "CGST Input",
        tallySgstLedger: "SGST Input",
        tallyIgstLedger: "IGST Input",
        tallyCessLedger: "Cess Input",
        tallyTdsLedger: "TDS Payable",
        tallyTcsLedger: "TCS Collected",
        csvColumns
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

interface DemoVendorSpec {
  name: string;
  pan: string | null;
  gstin: string | null;
  defaultGlCode: string | null;
  defaultTdsSection: string | null;
  msme: {
    udyamNumber: string;
    classification: "micro" | "small" | "medium";
    agreedPaymentDays: number;
  } | null;
}

async function seedVendorMasters(tenantId: string): Promise<void> {
  const now = new Date();
  const vendors: DemoVendorSpec[] = [
    {
      name: "Sprinto Technology Private Limited",
      pan: "ABCCS8316F",
      gstin: "29ABCCS8316F1Z7",
      defaultGlCode: "4008",
      defaultTdsSection: "194J",
      msme: null
    },
    {
      name: "Acme Contractors LLP",
      pan: null,
      gstin: null,
      defaultGlCode: null,
      defaultTdsSection: null,
      msme: {
        udyamNumber: "UDYAM-KA-02-0001234",
        classification: "small",
        agreedPaymentDays: 45
      }
    },
    {
      name: "Delta Engineering Works",
      pan: null,
      gstin: null,
      defaultGlCode: null,
      defaultTdsSection: null,
      msme: {
        udyamNumber: "UDYAM-KA-02-0005678",
        classification: "micro",
        agreedPaymentDays: 30
      }
    }
  ];

  for (const vendor of vendors) {
    const vendorFingerprint = slugify(vendor.name);
    const update: Record<string, unknown> = {
      tenantId,
      vendorFingerprint,
      name: vendor.name,
      pan: vendor.pan,
      gstin: vendor.gstin,
      defaultGlCode: vendor.defaultGlCode,
      defaultTdsSection: vendor.defaultTdsSection,
      msme: vendor.msme
        ? {
            udyamNumber: vendor.msme.udyamNumber,
            classification: vendor.msme.classification,
            agreedPaymentDays: vendor.msme.agreedPaymentDays,
            verifiedAt: now
          }
        : {
            udyamNumber: null,
            classification: null,
            agreedPaymentDays: null,
            verifiedAt: null
          }
    };

    await VendorMasterModel.findOneAndUpdate(
      { tenantId, vendorFingerprint },
      {
        $set: update,
        $setOnInsert: { lastInvoiceDate: now, invoiceCount: 0 }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
}

const APPROVAL_LIMITS: Array<{ role: string; limit: number | null }> = [
  { role: "ap_clerk", limit: 2500000 },
  { role: "senior_accountant", limit: 10000000 },
  { role: "ca", limit: 50000000 },
  { role: "TENANT_ADMIN", limit: null },
  { role: "audit_clerk", limit: 0 }
];

async function seedApprovalLimits(tenantId: string): Promise<void> {
  for (const { role, limit } of APPROVAL_LIMITS) {
    await TenantUserRoleModel.updateMany(
      { tenantId, role },
      { $set: { "capabilities.approvalLimitMinor": limit } }
    );
  }
}

async function seedApprovalWorkflow(
  tenantId: string,
  mahirUserId: string,
  cfoUserId: string
): Promise<void> {
  const service = new ApprovalWorkflowService();
  await service.saveWorkflowConfig(
    tenantId,
    {
      enabled: true,
      mode: "advanced",
      simpleConfig: { requireManagerReview: false, requireFinalSignoff: false },
      steps: [
        {
          order: 1,
          name: "Manager review",
          type: "approval",
          approverType: "role",
          approverRole: "senior_accountant",
          rule: "any"
        },
        {
          order: 2,
          name: "Compliance sign-off",
          type: "compliance_signoff",
          approverType: "capability",
          approverCapability: "canSignOffCompliance",
          rule: "any",
          condition: { field: "totalAmountMinor", operator: "gt", value: 5000000 }
        },
        {
          order: 3,
          name: "Risk review",
          type: "approval",
          approverType: "role",
          approverRole: "ca",
          rule: "any",
          condition: { field: "riskSignalMaxSeverity", operator: "gte", value: 2 }
        },
        {
          order: 4,
          name: "CFO escalation",
          type: "escalation",
          approverType: "specific_users",
          approverUserIds: [cfoUserId],
          rule: "any",
          timeoutHours: 24,
          escalateTo: mahirUserId,
          condition: { field: "totalAmountMinor", operator: "gt", value: 25000000 }
        }
      ]
    },
    mahirUserId
  );
}

/**
 * Seed configuration-only state for the demo tenant (Neelam and Associates).
 *
 * Idempotent: every write uses upsert / updateMany semantics so re-running leaves
 * the tenant in an identical state.
 *
 * Order matters — approval workflow is last because `saveWorkflowConfig` can
 * reference user ids (e.g. CFO/escalation targets) that must exist first.
 */
export async function seedDemoTenantConfig(tenantId: string, mahirUserId: string): Promise<void> {
  logger.info("demo.seed.start", { tenantId });

  const cfoUser = await UserModel.findOne({ email: "mahir-cfo@neelam.test" }).lean();
  if (!cfoUser) {
    throw new Error(
      "Demo tenant seed: CFO escalation target 'mahir-cfo@neelam.test' not found. " +
        "Ensure seedLocalDemoData has run so all Neelam users exist before seeding config."
    );
  }
  const cfoUserId = String(cfoUser._id);

  await seedComplianceConfig(tenantId);
  await seedTcsConfig(tenantId, mahirUserId);
  await seedNotificationConfig(tenantId, mahirUserId);
  await seedExportConfig(tenantId);
  await seedVendorMasters(tenantId);
  await seedApprovalLimits(tenantId);
  await seedApprovalWorkflow(tenantId, mahirUserId, cfoUserId);

  logger.info("demo.seed.complete", { tenantId });
}
