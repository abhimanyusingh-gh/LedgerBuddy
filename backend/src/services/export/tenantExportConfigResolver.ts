import { TenantExportConfigModel } from "@/models/integration/TenantExportConfig.js";
import type { TallyExporterConfig, TallyGstLedgerConfig } from "@/services/export/tallyExporter/xml.js";
import { env } from "@/config/env.js";

export interface ResolvedTallyConfig {
  companyName: string;
  purchaseLedgerName: string;
  gstLedgers: TallyGstLedgerConfig;
  tdsLedgerPrefix: string;
  tcsLedgerName: string;
}

export interface ResolvedCsvColumnConfig {
  columns: Array<{ key: string; label: string }> | undefined;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string {
  for (const v of values) {
    if (v != null && v.length > 0) return v;
  }
  return "";
}

export async function buildTallyExportConfig(
  tenantId: string,
  systemDefaults: Pick<TallyExporterConfig, "companyName" | "purchaseLedgerName" | "gstLedgers" | "tdsLedgerPrefix" | "tcsLedgerName">
): Promise<ResolvedTallyConfig> {
  const tenantConfig = await TenantExportConfigModel.findOne({ tenantId }).lean();

  return {
    companyName: firstNonEmpty(tenantConfig?.tallyCompanyName, systemDefaults.companyName, env.TALLY_COMPANY),
    purchaseLedgerName: firstNonEmpty(tenantConfig?.tallyPurchaseLedger, systemDefaults.purchaseLedgerName, env.TALLY_PURCHASE_LEDGER),
    gstLedgers: {
      cgstLedger: firstNonEmpty(tenantConfig?.tallyCgstLedger, systemDefaults.gstLedgers?.cgstLedger, env.TALLY_CGST_LEDGER),
      sgstLedger: firstNonEmpty(tenantConfig?.tallySgstLedger, systemDefaults.gstLedgers?.sgstLedger, env.TALLY_SGST_LEDGER),
      igstLedger: firstNonEmpty(tenantConfig?.tallyIgstLedger, systemDefaults.gstLedgers?.igstLedger, env.TALLY_IGST_LEDGER),
      cessLedger: firstNonEmpty(tenantConfig?.tallyCessLedger, systemDefaults.gstLedgers?.cessLedger, env.TALLY_CESS_LEDGER)
    },
    tdsLedgerPrefix: firstNonEmpty(tenantConfig?.tallyTdsLedger, systemDefaults.tdsLedgerPrefix, env.TALLY_TDS_LEDGER),
    tcsLedgerName: firstNonEmpty(tenantConfig?.tallyTcsLedger, systemDefaults.tcsLedgerName, env.TALLY_TCS_LEDGER)
  };
}

export async function buildCsvExportConfig(tenantId: string): Promise<ResolvedCsvColumnConfig> {
  const tenantConfig = await TenantExportConfigModel.findOne({ tenantId }).lean();

  if (tenantConfig?.csvColumns && tenantConfig.csvColumns.length > 0) {
    return { columns: tenantConfig.csvColumns };
  }

  return { columns: undefined };
}
