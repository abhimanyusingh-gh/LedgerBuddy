export type InvoiceStatus =
  | "PENDING"
  | "PARSED"
  | "NEEDS_REVIEW"
  | "AWAITING_APPROVAL"
  | "FAILED_OCR"
  | "FAILED_PARSE"
  | "APPROVED"
  | "EXPORTED";

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
  riskFlags: Array<"TOTAL_AMOUNT_ABOVE_EXPECTED" | "DUE_DATE_TOO_FAR">;
  riskMessages: string[];
  parsed?: {
    invoiceNumber?: string;
    vendorName?: string;
    invoiceDate?: string;
    dueDate?: string;
    totalAmountMinor?: number;
    currency?: string;
    notes?: string[];
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
  createdAt: string;
  updatedAt: string;
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

export interface ExportResultItem {
  invoiceId: string;
  success: boolean;
  externalReference?: string;
  error?: string;
}

export interface TallyFileExportResponse {
  batchId?: string;
  fileKey?: string;
  filename?: string;
  total: number;
  includedCount: number;
  skippedCount: number;
  skippedItems: ExportResultItem[];
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
}

export type GmailConnectionState = "DISCONNECTED" | "CONNECTED" | "NEEDS_REAUTH";

export interface DailyStat { date: string; count: number; amountMinor?: number; }
export interface VendorStat { vendor: string; count: number; amountMinor: number; }
export interface StatusStat { status: string; count: number; }

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
  statusBreakdown: StatusStat[];
  topVendorsByApproved: VendorStat[];
  topVendorsByPending: VendorStat[];
}

export interface GmailConnectionStatus {
  provider: "gmail";
  emailAddress?: string;
  connectionState: GmailConnectionState;
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

export interface WorkflowStepCondition {
  field: string;
  operator: "gt" | "gte" | "lt" | "lte";
  value: number;
}

export interface WorkflowStep {
  order: number;
  name: string;
  approverType: "any_member" | "role" | "specific_users";
  approverRole?: string;
  approverUserIds?: string[];
  rule: "any" | "all";
  condition?: WorkflowStepCondition | null;
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
