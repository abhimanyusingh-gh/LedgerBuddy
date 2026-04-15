import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import type { ExportContentType } from "@/types/mime.js";

export interface ExportResultItem {
  invoiceId: string;
  success: boolean;
  externalReference?: string;
  error?: string;
}

export interface ExportFileResult {
  content: Buffer;
  contentType: ExportContentType;
  filename: string;
  includedCount: number;
  skippedItems: ExportResultItem[];
}

export interface AccountingExporter {
  readonly system: string;
  exportInvoices(invoices: InvoiceDocument[]): Promise<ExportResultItem[]>;
  generateImportFile?(invoices: InvoiceDocument[]): ExportFileResult;
}
