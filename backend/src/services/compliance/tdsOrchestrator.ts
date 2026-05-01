import type { Types } from "mongoose";
import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { TdsCalculationService, TdsCalculationResult, TdsLowerDeductionCert } from "@/services/compliance/TdsCalculationService.js";
import type { TdsVendorLedgerService } from "@/services/tds/TdsVendorLedgerService.js";
import { determineFY } from "@/services/tds/fiscalYearUtils.js";

interface TdsOrchestratorInput {
  tdsCalculation: TdsCalculationService;
  tdsVendorLedger: TdsVendorLedgerService;
  invoice: ParsedInvoiceData;
  glCategory: string | null;
  tenantId: string;
  clientOrgId: Types.ObjectId;
  vendorFingerprint: string;
  invoiceId?: string;
  dryRun: boolean;
  vendorCert?: TdsLowerDeductionCert | null;
  now?: Date;
}

export async function runTdsOrchestrator(input: TdsOrchestratorInput): Promise<TdsCalculationResult | null> {
  const {
    tdsCalculation, tdsVendorLedger, invoice, glCategory,
    tenantId, clientOrgId, vendorFingerprint, invoiceId,
    dryRun, vendorCert, now
  } = input;

  const evaluatedNow = now ?? new Date();
  const panCategory = tdsCalculation.getPanCategory(invoice.pan);
  const detection = await tdsCalculation.detectSection(panCategory, glCategory, tenantId, clientOrgId);

  if (!detection.section) {
    return tdsCalculation.computeTds({
      invoice, glCategory, rateLookup: null, detection,
      cumulative: null, vendorCert, now: evaluatedNow
    });
  }

  const rateLookup = await tdsCalculation.lookupRate(detection.section, panCategory, tenantId, clientOrgId);
  const invoiceDate = invoice.invoiceDate ?? evaluatedNow;
  const fy = determineFY(invoiceDate);

  const cumulative = await tdsVendorLedger.getCumulativeForVendor(tenantId, vendorFingerprint, fy, detection.section);

  const result = tdsCalculation.computeTds({
    invoice, glCategory, rateLookup, detection,
    cumulative: {
      cumulativeBaseMinor: cumulative.cumulativeBaseMinor,
      cumulativeTdsMinor: cumulative.cumulativeTdsMinor,
      entries: cumulative.entries
    },
    vendorCert,
    now: evaluatedNow
  });

  const shouldRecord = !dryRun
    && invoiceId
    && result.tds.section
    && result.tds.quarter
    && result.ledgerDelta.taxableAmountMinor > 0;

  if (shouldRecord) {
    await tdsVendorLedger.recordTdsToLedger({
      tenantId,
      vendorFingerprint,
      financialYear: fy,
      section: result.tds.section as string,
      invoiceId: invoiceId as string,
      invoiceDate,
      taxableAmountMinor: result.ledgerDelta.taxableAmountMinor,
      tdsAmountMinor: result.ledgerDelta.tdsAmountMinor,
      rateBps: result.ledgerDelta.rateBps,
      rateSource: result.ledgerDelta.rateSource,
      thresholdCrossed: result.ledgerDelta.thresholdJustCrossed
    });
  }

  return result;
}
