import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import type { ExportContentType } from "@/types/mime.js";
import type { UUID } from "@/types/uuid.js";

export interface ExportResultItem {
  invoiceId: UUID;
  success: boolean;
  externalReference?: string;
  error?: string;
  lineErrorOrdinal?: number;
  exportVersion?: number;
  guid?: string;
}

export interface ExportFileResult {
  content: Buffer;
  contentType: ExportContentType;
  filename: string;
  includedCount: number;
  skippedItems: ExportResultItem[];
}

export interface ExportInvoicesOptions {
  forceAlter?: boolean;
}

export interface AccountingExporter {
  readonly system: string;
  exportInvoices(
    invoices: InvoiceDocument[],
    tenantId?: string,
    options?: ExportInvoicesOptions
  ): Promise<ExportResultItem[]>;
  generateImportFile?(invoices: InvoiceDocument[], tenantId?: string): ExportFileResult | Promise<ExportFileResult>;
}
