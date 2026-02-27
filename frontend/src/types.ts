export type InvoiceStatus =
  | "PARSED"
  | "NEEDS_REVIEW"
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
  };
  metadata?: Record<string, string | undefined>;
  status: InvoiceStatus;
  processingIssues: string[];
  approval?: {
    approvedBy?: string;
    approvedAt?: string;
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
}

export interface ExportResultItem {
  invoiceId: string;
  success: boolean;
  externalReference?: string;
  error?: string;
}

export interface TallyExportResponse {
  batchId?: string;
  total: number;
  successCount: number;
  failureCount: number;
  items: ExportResultItem[];
}

export interface IngestionJobStatus {
  state: "idle" | "running" | "completed" | "failed";
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

export interface GmailConnectionStatus {
  provider: "gmail";
  emailAddress?: string;
  connectionState: GmailConnectionState;
  lastErrorReason?: string;
  lastSyncedAt?: string;
}
