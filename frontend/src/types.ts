export type TenantViewTab = "overview" | "dashboard" | "config" | "exports" | "statements" | "connections";

export type InvoiceStatus =
  | "PENDING"
  | "PARSED"
  | "NEEDS_REVIEW"
  | "AWAITING_APPROVAL"
  | "FAILED_OCR"
  | "FAILED_PARSE"
  | "APPROVED"
  | "EXPORTED";

type BoundingBox = [number, number, number, number];

export interface InvoiceFieldProvenance {
  source?: string;
  page?: number;
  bbox?: BoundingBox;
  bboxNormalized?: BoundingBox;
  bboxModel?: BoundingBox;
  blockIndex?: number;
  confidence?: number;
}

export interface InvoiceLineItemProvenance {
  index: number;
  row?: InvoiceFieldProvenance;
  fields?: Record<string, InvoiceFieldProvenance>;
}

export interface InvoiceExtractionData {
  source?: string;
  strategy?: string;
  invoiceType?: string;
  classification?: {
    invoiceType?: string;
    category?: string;
    glCategory?: string;
    tdsSection?: string;
  };
  fieldConfidence?: Record<string, number>;
  fieldProvenance?: Record<string, InvoiceFieldProvenance>;
  lineItemProvenance?: InvoiceLineItemProvenance[];
  fieldOverlayPaths?: Record<string, string>;
}

export interface Invoice {
  _id: string;
  tenantId: string;
  workloadTier: "standard" | "heavy";
  sourceType: string;
  sourceKey: string;
  sourceDocumentId: string;
  attachmentName: string;
  mimeType: string;
  receivedAt: string;
  ocrProvider?: string;
  ocrText?: string;
  ocrConfidence?: number;
  ocrBlocks?: Array<{
    text: string;
    page: number;
    bbox: [number, number, number, number];
    bboxNormalized?: [number, number, number, number];
    bboxModel?: [number, number, number, number];
    blockType?: string;
    cropPath?: string;
  }>;
  confidenceScore: number;
  confidenceTone: "red" | "yellow" | "green";
  autoSelectForApproval: boolean;
  parsed?: {
    invoiceNumber?: string;
    vendorName?: string;
    invoiceDate?: string;
    dueDate?: string;
    totalAmountMinor?: number;
    currency?: string;
    notes?: string[];
    lineItems?: Array<{
      description: string;
      hsnSac?: string;
      quantity?: number;
      rate?: number;
      amountMinor: number;
      taxRate?: number;
      cgstMinor?: number;
      sgstMinor?: number;
      igstMinor?: number;
    }>;
    gst?: {
      gstin?: string;
      subtotalMinor?: number;
      cgstMinor?: number;
      sgstMinor?: number;
      igstMinor?: number;
      cessMinor?: number;
      totalTaxMinor?: number;
    };
  };
  extraction?: InvoiceExtractionData;
  metadata?: Record<string, string | undefined>;
  status: InvoiceStatus;
  possibleDuplicate?: boolean;
  processingIssues: string[];
  approval?: {
    approvedBy?: string;
    approvedAt?: string;
    email?: string;
  };
  workflowState?: {
    workflowId?: string;
    currentStep?: number;
    status?: "in_progress" | "approved" | "rejected";
    stepResults?: Array<{
      step: number;
      name: string;
      action: "approved" | "rejected" | "skipped";
      userId?: string;
      email?: string;
      role?: string;
      timestamp: string;
      note?: string;
    }>;
  };
  export?: {
    system?: string;
    batchId?: string;
    exportedAt?: string;
    externalReference?: string;
    error?: string;
  };
  compliance?: InvoiceCompliance;
  complianceSummary?: {
    tdsSection: string | null;
    glCode: string | null;
    riskSignalCount: number;
    riskSignalMaxSeverity: "info" | "warning" | "critical" | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceCompliance {
  pan?: {
    value: string | null;
    source: "extracted" | "vendor-master" | "manual";
    validationLevel: "L1" | "L2" | "L3" | null;
    validationResult: "valid" | "format-invalid" | "gstin-mismatch" | "struck-off" | null;
    gstinCrossRef: boolean;
  };
  tds?: {
    section: string | null;
    rate: number | null;
    amountMinor: number | null;
    netPayableMinor: number | null;
    source: "auto" | "manual";
    confidence: "high" | "medium" | "low";
  };
  glCode?: {
    code: string | null;
    name: string | null;
    source: "vendor-default" | "description-match" | "slm-classification" | "category-default" | "manual";
    confidence: number | null;
    suggestedAlternatives?: Array<{ code: string; name: string; score: number }>;
  };
  costCenter?: {
    code: string | null;
    name: string | null;
    source: "vendor-default" | "gl-linked" | "manual";
    confidence: number | null;
  };
  tcs?: {
    rate: number | null;
    amountMinor: number | null;
    source: "extracted" | "configured" | "manual";
  };
  vendorBank?: {
    accountHash: string | null;
    ifsc: string | null;
    bankName: string | null;
    isChanged: boolean;
    verifiedChange: boolean;
  };
  reconciliation?: {
    bankTransactionId: string | null;
    verifiedByStatement: boolean;
    matchedAt: string | null;
  };
  riskSignals?: Array<{
    code: string;
    category: "financial" | "compliance" | "fraud" | "data-quality";
    severity: "info" | "warning" | "critical";
    message: string;
    confidencePenalty: number;
    status: "open" | "dismissed" | "acted-on";
    resolvedBy: string | null;
    resolvedAt: string | null;
  }>;
}

export interface GlCode {
  _id: string;
  tenantId: string;
  code: string;
  name: string;
  category: string;
  linkedTdsSection: string | null;
  isActive: boolean;
}

export interface TdsRate {
  section: string;
  description: string;
  rateCompanyBps: number;
  rateIndividualBps: number;
  rateNoPanBps: number;
}

export interface TdsRateEntry {
  section: string;
  description: string;
  rateIndividual: number;
  rateCompany: number;
  rateNoPan: number;
  threshold: number;
  active: boolean;
}

export interface RiskSignalDefinition {
  code: string;
  description: string;
  category: string;
}

export interface TenantComplianceConfig {
  complianceEnabled: boolean;
  autoSuggestGlCodes: boolean;
  autoDetectTds: boolean;
  tdsEnabled: boolean;
  tdsRates: TdsRateEntry[];
  panValidationEnabled: boolean;
  panValidationLevel: "format" | "format_and_checksum" | "disabled";
  riskSignalsEnabled: boolean;
  activeRiskSignals: string[];
  disabledSignals: string[];
  defaultTdsSection: string | null;
  updatedBy: string | null;
  updatedAt?: string;
  reconciliationWeightExactAmount?: number;
  reconciliationWeightCloseAmount?: number;
  reconciliationWeightInvoiceNumber?: number;
  reconciliationWeightVendorName?: number;
  reconciliationWeightDateProximity?: number;
}

export type TenantRole =
  | "TENANT_ADMIN"
  | "ap_clerk"
  | "senior_accountant"
  | "ca"
  | "tax_specialist"
  | "firm_partner"
  | "ops_admin"
  | "audit_clerk";

export type SessionRole = "PLATFORM_ADMIN" | TenantRole;

export const TENANT_ROLE_OPTIONS: Array<{ value: TenantRole; label: string }> = [
  { value: "TENANT_ADMIN", label: "Tenant Admin" },
  { value: "ap_clerk", label: "AP Clerk" },
  { value: "senior_accountant", label: "Senior Accountant" },
  { value: "ca", label: "Chartered Accountant" },
  { value: "tax_specialist", label: "Tax Specialist" },
  { value: "firm_partner", label: "Firm Partner" },
  { value: "ops_admin", label: "IT/Ops Admin" },
  { value: "audit_clerk", label: "Audit Clerk" }
];

export const PERSONA_ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ap_clerk", label: "AP Clerk" },
  { value: "senior_accountant", label: "Senior Accountant" },
  { value: "ca", label: "Chartered Accountant" },
  { value: "tax_specialist", label: "Tax Specialist" },
  { value: "firm_partner", label: "Firm Partner" },
  { value: "ops_admin", label: "IT/Ops Admin" },
  { value: "audit_clerk", label: "Audit Clerk" },
];

export const CAPABILITY_FLAG_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "canApproveInvoices", label: "Can Approve Invoices" },
  { value: "canEditInvoiceFields", label: "Can Edit Invoice Fields" },
  { value: "canDeleteInvoices", label: "Can Delete Invoices" },
  { value: "canRetryInvoices", label: "Can Retry Invoices" },
  { value: "canUploadFiles", label: "Can Upload Files" },
  { value: "canStartIngestion", label: "Can Start Ingestion" },
  { value: "canOverrideTds", label: "Can Override TDS" },
  { value: "canOverrideGlCode", label: "Can Override GL Code" },
  { value: "canSignOffCompliance", label: "Can Sign Off Compliance" },
  { value: "canConfigureTdsMappings", label: "Can Configure TDS Mappings" },
  { value: "canConfigureGlCodes", label: "Can Configure GL Codes" },
  { value: "canManageUsers", label: "Can Manage Users" },
  { value: "canManageConnections", label: "Can Manage Connections" },
  { value: "canExportToTally", label: "Can Export to Tally" },
  { value: "canExportToCsv", label: "Can Export to CSV" },
  { value: "canDownloadComplianceReports", label: "Can Download Compliance Reports" },
  { value: "canViewAllInvoices", label: "Can View All Invoices" },
  { value: "canConfigureWorkflow", label: "Can Configure Workflow" },
  { value: "canConfigureCompliance", label: "Can Configure Compliance" },
  { value: "canManageCostCenters", label: "Can Manage Cost Centers" },
  { value: "canSendVendorEmails", label: "Can Send Vendor Emails" },
];

export const RISK_SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];

export const GL_CODE_SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "manual", label: "Manual" },
  { value: "auto", label: "Auto" },
  { value: "override", label: "Override" },
];

export interface UserCapabilities {
  approvalLimitMinor: number | null;
  canApproveInvoices: boolean;
  canEditInvoiceFields: boolean;
  canDeleteInvoices: boolean;
  canRetryInvoices: boolean;
  canUploadFiles: boolean;
  canStartIngestion: boolean;
  canOverrideTds: boolean;
  canOverrideGlCode: boolean;
  canSignOffCompliance: boolean;
  canConfigureTdsMappings: boolean;
  canConfigureGlCodes: boolean;
  canManageUsers: boolean;
  canManageConnections: boolean;
  canExportToTally: boolean;
  canExportToCsv: boolean;
  canDownloadComplianceReports: boolean;
  canViewAllInvoices: boolean;
  canConfigureWorkflow: boolean;
  canConfigureCompliance: boolean;
  canManageCostCenters: boolean;
  canSendVendorEmails: boolean;
}

export interface RoleWithCapabilities {
  role: SessionRole;
  capabilities: UserCapabilities;
}

export interface TenantUser {
  userId: string;
  email: string;
  role: TenantRole;
  enabled: boolean;
}

export interface BankStatementSummary {
  _id: string;
  tenantId: string;
  fileName: string;
  bankName: string | null;
  accountNumberMasked: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  transactionCount: number;
  matchedCount: number;
  unmatchedCount: number;
  source: "pdf-parsed" | "csv-import";
  gstin: string | null;
  gstinLabel: string | null;
  createdAt: string;
}

export interface ReconciliationMatchItem {
  _id: string;
  date: string;
  description: string;
  reference: string | null;
  debitMinor: number | null;
  creditMinor: number | null;
  balanceMinor: number | null;
  matchStatus: "matched" | "suggested" | "unmatched" | "manual";
  matchConfidence: number | null;
  matchedInvoiceId: string | null;
  invoice: {
    _id: string;
    invoiceNumber: string | null;
    vendorName: string | null;
    totalAmountMinor: number | null;
    invoiceDate: string | null;
    status: string;
  } | null;
}

interface ReconciliationMatchesResponse {
  items: ReconciliationMatchItem[];
  summary: {
    totalTransactions: number;
    matched: number;
    suggested: number;
    unmatched: number;
  };
}

export interface BankTransactionEntry {
  _id: string;
  statementId: string;
  date: string;
  description: string;
  reference: string | null;
  debitMinor: number | null;
  creditMinor: number | null;
  balanceMinor: number | null;
  matchedInvoiceId: string | null;
  matchConfidence: number | null;
  matchStatus: "matched" | "suggested" | "unmatched" | "manual";
}

export interface InvoiceListResponse {
  items: Invoice[];
  page: number;
  limit: number;
  total: number;
  totalAll?: number;
  approvedAll?: number;
  pendingAll?: number;
  failedAll?: number;
  needsReviewAll?: number;
  parsedAll?: number;
  awaitingApprovalAll?: number;
  failedOcrAll?: number;
  failedParseAll?: number;
  exportedAll?: number;
}

export interface TallyFileExportResponse {
  batchId?: string;
  fileKey?: string;
  filename?: string;
  total: number;
  includedCount: number;
  skippedCount: number;
  skippedItems: Array<{ invoiceId: string; success: boolean; externalReference?: string; error?: string }>;
}

export interface ExportBatchSummary {
  batchId: string;
  system: string;
  total: number;
  successCount: number;
  failureCount: number;
  requestedBy: string;
  hasFile: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExportHistoryResponse {
  items: ExportBatchSummary[];
  page: number;
  limit: number;
  total: number;
}

export interface IngestionJobStatus {
  state: "idle" | "running" | "completed" | "failed" | "paused";
  running: boolean;
  totalFiles: number;
  processedFiles: number;
  newInvoices: number;
  duplicates: number;
  failures: number;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  correlationId?: string;
  lastUpdatedAt: string;
  systemAlert?: string;
}

export interface DailyStat { date: string; count: number; amountMinor?: number; }
export interface VendorStat { vendor: string; count: number; amountMinor: number; }

export interface AnalyticsOverview {
  kpis: {
    totalInvoices: number;
    approvedCount: number;
    approvedAmountMinor: number;
    pendingAmountMinor: number;
    exportedCount: number;
    needsReviewCount: number;
  };
  dailyApprovals: DailyStat[];
  dailyIngestion: DailyStat[];
  dailyExports: DailyStat[];
  statusBreakdown: Array<{ status: string; count: number }>;
  topVendorsByApproved: VendorStat[];
  topVendorsByPending: VendorStat[];
}

export interface GmailConnectionStatus {
  provider: "gmail";
  emailAddress?: string;
  connectionState: "DISCONNECTED" | "CONNECTED" | "NEEDS_REAUTH";
  lastErrorReason?: string;
  lastSyncedAt?: string;
}

export interface TenantMailbox {
  _id: string;
  provider: "gmail";
  emailAddress?: string;
  status: string;
  assignments: "all" | Array<{ userId: string; email: string }>;
  lastSyncedAt?: string;
  pollingConfig?: {
    enabled: boolean;
    intervalHours: number;
    lastPolledAt?: string;
    nextPollAfter?: string;
  };
}

export type WorkflowStepType = "approval" | "compliance_signoff" | "escalation";

export type WorkflowApproverType = "any_member" | "role" | "specific_users" | "persona" | "capability";

export type WorkflowConditionField = "totalAmountMinor" | "tdsAmountMinor" | "riskSignalMaxSeverity" | "glCodeSource";

export type WorkflowConditionOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "in";

export interface WorkflowStepCondition {
  field: WorkflowConditionField;
  operator: WorkflowConditionOperator;
  value: number | string | string[];
}

export interface ApproverState {
  approverType: WorkflowApproverType;
  approverRole?: string;
  approverUserIds?: string[];
  approverPersona?: string;
  approverCapability?: string;
}

export interface WorkflowStep {
  order: number;
  name: string;
  type?: WorkflowStepType;
  approverType: WorkflowApproverType;
  approverRole?: string;
  approverUserIds?: string[];
  approverPersona?: string;
  approverCapability?: string;
  rule: "any" | "all";
  condition?: WorkflowStepCondition | null;
  timeoutHours?: number | null;
  escalateTo?: string | null;
}

export interface ApprovalWorkflowConfig {
  enabled: boolean;
  mode: "simple" | "advanced";
  simpleConfig: {
    requireManagerReview: boolean;
    requireFinalSignoff: boolean;
  };
  steps: WorkflowStep[];
}

export interface TcsRateChange {
  previousRate: number;
  newRate: number;
  changedBy: string;
  changedByName: string;
  changedAt: string;
  reason?: string | null;
  effectiveFrom: string;
}

export interface TcsConfig {
  ratePercent: number;
  effectiveFrom: string;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string;
  tcsModifyRoles: string[];
  history: TcsRateChange[];
}

export interface BankAccount {
  _id: string;
  tenantId: string;
  status: string;
  aaAddress: string;
  displayName?: string;
  bankName?: string;
  maskedAccNumber?: string;
  balanceMinor?: number;
  currency: string;
  balanceFetchedAt?: string;
  lastErrorReason?: string;
  createdAt: string;
}
