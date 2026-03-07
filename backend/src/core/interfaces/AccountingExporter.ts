import type { InvoiceDocument } from "../../models/Invoice.js";

export interface ExportResultItem {
  invoiceId: string;
  success: boolean;
  externalReference?: string;
  error?: string;
}

export interface ExportFileResult {
  content: Buffer;
  contentType: string;
  filename: string;
  includedCount: number;
  skippedItems: ExportResultItem[];
}

export interface AccountingExporter {
  readonly system: string;
  exportInvoices(invoices: InvoiceDocument[]): Promise<ExportResultItem[]>;
  generateImportFile?(invoices: InvoiceDocument[]): ExportFileResult;
}
