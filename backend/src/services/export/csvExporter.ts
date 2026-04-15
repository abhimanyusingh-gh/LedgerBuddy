import type { InvoiceDocument } from "@/models/invoice/Invoice.js";
import { minorUnitsToMajorString } from "@/utils/currency.js";
import { isRecord } from "@/utils/validation.js";
import { INVOICE_STATUS } from "@/types/invoice.js";
import { buildCsvExportConfig } from "@/services/export/tenantExportConfigResolver.js";
import { resolveDefaultCurrencyConfig } from "@/services/compliance/tenantConfigResolver.js";

const DEFAULT_COLUMNS = [
  "invoiceNumber", "vendorName", "invoiceDate", "dueDate",
  "total", "currency", "tdsSection", "tdsAmount", "tdsNetPayable",
  "glCode", "costCenter", "cgst", "sgst", "igst", "cess", "pan", "gstin"
];

interface CsvExportResult {
  content: string;
  filename: string;
  includedCount: number;
  skippedCount: number;
}

export async function generateCsvExport(
  invoices: InvoiceDocument[],
  columns?: string[],
  tenantId?: string
): Promise<CsvExportResult> {
  let cols = columns && columns.length > 0 ? columns : undefined;
  let headerOverrides: Record<string, string> | undefined;

  if (!cols && tenantId) {
    const tenantCsvConfig = await buildCsvExportConfig(tenantId);
    if (tenantCsvConfig.columns && tenantCsvConfig.columns.length > 0) {
      cols = tenantCsvConfig.columns.map(c => c.key);
      headerOverrides = Object.fromEntries(tenantCsvConfig.columns.map(c => [c.key, c.label]));
    }
  }

  if (!cols) cols = DEFAULT_COLUMNS;

  let tenantDefaultCurrency = "INR";
  if (tenantId) {
    const currencyConfig = await resolveDefaultCurrencyConfig(tenantId);
    if (currencyConfig?.defaultCurrency) tenantDefaultCurrency = currencyConfig.defaultCurrency;
  }

  let skippedCount = 0;

  const effectiveHeaders = headerOverrides ? { ...COLUMN_HEADERS, ...headerOverrides } : COLUMN_HEADERS;
  const header = cols.map(c => csvEscape(effectiveHeaders[c] ?? c)).join(",");
  const rows: string[] = [];

  for (const inv of invoices) {
    if (inv.status !== INVOICE_STATUS.APPROVED && inv.status !== INVOICE_STATUS.EXPORTED) {
      skippedCount++;
      continue;
    }

    const invObj = inv as unknown as Record<string, unknown>;
    const compliance = isRecord(invObj.compliance) ? invObj.compliance : undefined;
    const tds = isRecord(compliance?.tds) ? compliance.tds : undefined;
    const gl = isRecord(compliance?.glCode) ? compliance.glCode : undefined;
    const cc = isRecord(compliance?.costCenter) ? compliance.costCenter : undefined;
    const pan = isRecord(compliance?.pan) ? compliance.pan : undefined;
    const currency = inv.parsed?.currency ?? tenantDefaultCurrency;

    const values: Record<string, string> = {
      invoiceNumber: inv.parsed?.invoiceNumber ?? "",
      vendorName: inv.parsed?.vendorName ?? "",
      invoiceDate: inv.parsed?.invoiceDate instanceof Date ? inv.parsed.invoiceDate.toISOString().slice(0, 10) : "",
      dueDate: inv.parsed?.dueDate instanceof Date ? inv.parsed.dueDate.toISOString().slice(0, 10) : "",
      total: inv.parsed?.totalAmountMinor != null ? minorUnitsToMajorString(inv.parsed.totalAmountMinor, currency) : "",
      currency,
      tdsSection: (tds?.section as string) ?? "",
      tdsAmount: tds?.amountMinor != null ? minorUnitsToMajorString(tds.amountMinor as number, currency) : "",
      tdsNetPayable: tds?.netPayableMinor != null ? minorUnitsToMajorString(tds.netPayableMinor as number, currency) : "",
      glCode: gl?.code ? `${gl.name} (${gl.code})` : "",
      costCenter: cc?.code ? `${cc.name} (${cc.code})` : "",
      cgst: inv.parsed?.gst?.cgstMinor != null ? minorUnitsToMajorString(inv.parsed.gst.cgstMinor, currency) : "",
      sgst: inv.parsed?.gst?.sgstMinor != null ? minorUnitsToMajorString(inv.parsed.gst.sgstMinor, currency) : "",
      igst: inv.parsed?.gst?.igstMinor != null ? minorUnitsToMajorString(inv.parsed.gst.igstMinor, currency) : "",
      cess: inv.parsed?.gst?.cessMinor != null ? minorUnitsToMajorString(inv.parsed.gst.cessMinor, currency) : "",
      pan: (pan?.value as string) ?? "",
      gstin: inv.parsed?.gst?.gstin ?? ""
    };

    rows.push(cols.map(c => csvEscape(values[c] ?? "")).join(","));
  }

  return {
    content: header + "\n" + rows.join("\n") + "\n",
    filename: `billforge-export-${new Date().toISOString().slice(0, 10)}.csv`,
    includedCount: rows.length,
    skippedCount
  };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const COLUMN_HEADERS: Record<string, string> = {
  invoiceNumber: "Invoice Number",
  vendorName: "Vendor Name",
  invoiceDate: "Invoice Date",
  dueDate: "Due Date",
  total: "Total Amount",
  currency: "Currency",
  tdsSection: "TDS Section",
  tdsAmount: "TDS Amount",
  tdsNetPayable: "Net Payable",
  glCode: "GL Code",
  costCenter: "Cost Center",
  cgst: "CGST",
  sgst: "SGST",
  igst: "IGST",
  cess: "Cess",
  pan: "PAN",
  gstin: "GSTIN"
};
