import type { Types } from "mongoose";
import { PAN_FORMAT, derivePanCategory } from "@/constants/indianCompliance.js";
import { TdsRateTableModel } from "@/models/compliance/TdsRateTable.js";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping.js";
import { resolveTdsRatesConfig } from "@/services/compliance/clientConfigResolver.js";
import type { ComplianceTdsResult, ComplianceRiskSignal, ParsedInvoiceData, TdsRateSource } from "@/types/invoice.js";
import { TDS_CONFIDENCE, TDS_RATE_SOURCE, TDS_SOURCE, type TdsConfidence } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";
import { determineFY, determineQuarter, type TdsQuarter } from "@/services/tds/fiscalYearUtils.js";

const NO_PAN_PENALTY_RATE_BPS = 2000;

interface TdsDetectionResult {
  section: string | null;
  confidence: TdsConfidence;
}

interface TdsRateLookup {
  rateBps: number;
  thresholdSingleMinor: number;
  thresholdAnnualMinor: number;
  source: "tenant" | "rateTable";
}

export interface TdsLowerDeductionCert {
  certificateNumber: string;
  section: string;
  applicableRateBps: number;
  validFrom: Date;
  validTo: Date;
  financialYear: string;
  maxAmountMinor: number;
  exhaustedAt?: Date | null;
}

interface TdsCumulativeInput {
  cumulativeBaseMinor: number;
  cumulativeTdsMinor: number;
  entries?: Array<{ rateBps: number }>;
}

export interface TdsLedgerDelta {
  taxableAmountMinor: number;
  tdsAmountMinor: number;
  rateBps: number;
  rateSource: TdsRateSource;
  thresholdJustCrossed: boolean;
}

export interface TdsCalculationResult {
  tds: ComplianceTdsResult;
  riskSignals: ComplianceRiskSignal[];
  ledgerDelta: TdsLedgerDelta;
}

interface ComputeTdsInput {
  invoice: ParsedInvoiceData;
  glCategory: string | null;
  rateLookup: TdsRateLookup | null;
  detection: TdsDetectionResult;
  cumulative: TdsCumulativeInput | null;
  vendorCert?: TdsLowerDeductionCert | null;
  now?: Date;
}

interface PanCategoryRates {
  noPan: number;
  company: number;
  individual: number;
}

function selectRateByPanCategory(panCategory: string | null, rates: PanCategoryRates): number {
  if (!panCategory) return rates.individual;
  if (panCategory === "C") return rates.company;
  return rates.individual;
}

function emptyDelta(rateBps = 0, rateSource: TdsRateSource = TDS_RATE_SOURCE.STANDARD): TdsLedgerDelta {
  return { taxableAmountMinor: 0, tdsAmountMinor: 0, rateBps, rateSource, thresholdJustCrossed: false };
}

function emptyTds(
  section: string | null,
  confidence: TdsConfidence,
  rateBps: number | null = null,
  rateSource: TdsRateSource | null = null
): ComplianceTdsResult {
  return {
    section,
    rate: rateBps,
    rateBps,
    rateSource,
    amountMinor: null,
    taxableBaseMinor: null,
    netPayableMinor: null,
    source: TDS_SOURCE.AUTO,
    confidence,
    quarter: null
  };
}

function totalGstMinor(gst: NonNullable<ParsedInvoiceData["gst"]>): number {
  return (gst.cgstMinor ?? 0) + (gst.sgstMinor ?? 0) + (gst.igstMinor ?? 0) + (gst.cessMinor ?? 0);
}

function isGstShownSeparately(gst: NonNullable<ParsedInvoiceData["gst"]>): boolean {
  return (
    (gst.cgstMinor != null && gst.cgstMinor > 0) ||
    (gst.sgstMinor != null && gst.sgstMinor > 0) ||
    (gst.igstMinor != null && gst.igstMinor > 0)
  );
}

function resolveEffectiveRate(args: {
  panValid: boolean;
  pan: string | null | undefined;
  rateLookup: TdsRateLookup;
  vendorCert: TdsLowerDeductionCert | null | undefined;
  cumulativeBaseMinor: number;
  invoiceFy: string;
  now: Date;
}): { effectiveRateBps: number; rateSource: TdsRateSource; certApplied: boolean } {
  const { panValid, pan, rateLookup, vendorCert, cumulativeBaseMinor, invoiceFy, now } = args;

  if (vendorCert
    && vendorCert.validFrom.getTime() <= now.getTime()
    && vendorCert.validTo.getTime() >= now.getTime()
    && vendorCert.financialYear === invoiceFy
    && !vendorCert.exhaustedAt
    && cumulativeBaseMinor < vendorCert.maxAmountMinor
  ) {
    return {
      effectiveRateBps: vendorCert.applicableRateBps,
      rateSource: TDS_RATE_SOURCE.SECTION_197,
      certApplied: true
    };
  }

  if (!pan || !panValid) {
    const effectiveRateBps = Math.max(NO_PAN_PENALTY_RATE_BPS, rateLookup.rateBps * 2);
    return {
      effectiveRateBps,
      rateSource: TDS_RATE_SOURCE.NO_PAN_206AA,
      certApplied: false
    };
  }

  return {
    effectiveRateBps: rateLookup.rateBps,
    rateSource: rateLookup.source === "tenant" ? TDS_RATE_SOURCE.TENANT_OVERRIDE : TDS_RATE_SOURCE.STANDARD,
    certApplied: false
  };
}

interface ThresholdComputationArgs {
  taxableAmount: number;
  totalAmount: number;
  effectiveRateBps: number;
  rateLookup: TdsRateLookup;
  cumulative: TdsCumulativeInput | null;
  section: string;
}

interface ThresholdComputation {
  tdsAmountMinor: number;
  netPayableMinor: number;
  thresholdJustCrossed: boolean;
  signals: ComplianceRiskSignal[];
}

function computeThresholdAndTds(args: ThresholdComputationArgs): ThresholdComputation {
  const { taxableAmount, totalAmount, effectiveRateBps, rateLookup, cumulative, section } = args;
  const previousCumulative = cumulative?.cumulativeBaseMinor ?? 0;
  const previousTdsDeducted = cumulative?.cumulativeTdsMinor ?? 0;
  const newCumulative = previousCumulative + taxableAmount;
  const annualThreshold = rateLookup.thresholdAnnualMinor;
  const signals: ComplianceRiskSignal[] = [];

  if (annualThreshold > 0 && newCumulative <= annualThreshold) {
    signals.push(createRiskSignal(
      RISK_SIGNAL_CODE.TDS_BELOW_ANNUAL_THRESHOLD,
      "compliance",
      "info",
      `Cumulative ${newCumulative / 100} INR at or below annual threshold ${annualThreshold / 100} INR for section ${section}. No TDS deducted.`,
      0
    ));
    return { tdsAmountMinor: 0, netPayableMinor: totalAmount, thresholdJustCrossed: false, signals };
  }

  if (annualThreshold > 0 && previousCumulative <= annualThreshold && newCumulative > annualThreshold) {
    const grossTds = Math.round(newCumulative * effectiveRateBps / 10000);
    const tdsAmountMinor = grossTds - previousTdsDeducted;
    const netPayableMinor = totalAmount - tdsAmountMinor;
    signals.push(createRiskSignal(
      RISK_SIGNAL_CODE.TDS_ANNUAL_THRESHOLD_CROSSED,
      "compliance",
      "warning",
      `Annual threshold (${annualThreshold / 100} INR) crossed for section ${section}. Catch-up TDS ${tdsAmountMinor / 100} INR.`,
      3
    ));

    if (cumulative?.entries && cumulative.entries.length > 0) {
      const historicalRates = new Set(cumulative.entries.map(e => e.rateBps));
      const variance = historicalRates.size > 1
        || (historicalRates.size === 1 && !historicalRates.has(effectiveRateBps));
      if (variance) {
        signals.push(createRiskSignal(
          RISK_SIGNAL_CODE.TDS_CATCHUP_RATE_VARIANCE,
          "compliance",
          "warning",
          `Catch-up uses current rate ${effectiveRateBps / 100}% but historical entries used different rates.`,
          6
        ));
      }
    }
    return { tdsAmountMinor, netPayableMinor, thresholdJustCrossed: true, signals };
  }

  if (rateLookup.thresholdSingleMinor > 0 && taxableAmount < rateLookup.thresholdSingleMinor) {
    signals.push(createRiskSignal(
      RISK_SIGNAL_CODE.TDS_BELOW_THRESHOLD,
      "compliance",
      "info",
      `Invoice amount below single-transaction TDS threshold for section ${section}.`,
      0
    ));
    return { tdsAmountMinor: 0, netPayableMinor: totalAmount, thresholdJustCrossed: false, signals };
  }

  const tdsAmountMinor = Math.round(taxableAmount * effectiveRateBps / 10000);
  const netPayableMinor = totalAmount - tdsAmountMinor;
  return { tdsAmountMinor, netPayableMinor, thresholdJustCrossed: false, signals };
}

export class TdsCalculationService {
  getPanCategory(pan: string | null | undefined): string | null {
    if (!pan || !PAN_FORMAT.test(pan.toUpperCase())) return null;
    return derivePanCategory(pan);
  }

  async detectSection(
    panCategory: string | null,
    glCategory: string | null,
    tenantId: string,
    clientOrgId: Types.ObjectId
  ): Promise<TdsDetectionResult> {
    if (!glCategory) {
      return { section: null, confidence: TDS_CONFIDENCE.LOW };
    }

    const effectivePanCategory = panCategory ?? "*";
    const queries = [
      { tenantId, clientOrgId, glCategory, panCategory: effectivePanCategory },
      { tenantId, clientOrgId, glCategory, panCategory: "*" },
      { tenantId: null, clientOrgId: null, glCategory, panCategory: effectivePanCategory },
      { tenantId: null, clientOrgId: null, glCategory, panCategory: "*" }
    ];

    for (const query of queries) {
      const mappings = await TdsSectionMappingModel.find(query).sort({ priority: -1 }).limit(2).lean();
      if (mappings.length === 0) continue;

      const confidence: TdsConfidence = mappings.length > 1 && mappings[0].priority === mappings[1].priority
        ? TDS_CONFIDENCE.MEDIUM
        : TDS_CONFIDENCE.HIGH;

      return { section: mappings[0].tdsSection, confidence };
    }

    return { section: null, confidence: TDS_CONFIDENCE.LOW };
  }

  async lookupRate(
    section: string,
    panCategory: string | null,
    tenantId?: string,
    clientOrgId?: Types.ObjectId
  ): Promise<TdsRateLookup | null> {
    if (tenantId && clientOrgId) {
      const tenantConfig = await resolveTdsRatesConfig(tenantId, clientOrgId);
      if (tenantConfig && tenantConfig.tdsRates && tenantConfig.tdsRates.length > 0) {
        const entry = tenantConfig.tdsRates.find((r: { section: string }) => r.section === section);
        if (entry) {
          if (!entry.active) return null;

          return {
            rateBps: selectRateByPanCategory(panCategory, {
              noPan: entry.rateNoPan,
              company: entry.rateCompany,
              individual: entry.rateIndividual
            }),
            thresholdSingleMinor: entry.threshold,
            thresholdAnnualMinor: 0,
            source: "tenant"
          };
        }
      }
    }

    const rate = await TdsRateTableModel.findOne({
      section,
      effectiveTo: null,
      isActive: true
    }).lean();

    if (!rate) return null;

    return {
      rateBps: selectRateByPanCategory(panCategory, {
        noPan: rate.rateNoPanBps,
        company: rate.rateCompanyBps,
        individual: rate.rateIndividualBps
      }),
      thresholdSingleMinor: rate.thresholdSingleMinor,
      thresholdAnnualMinor: rate.thresholdAnnualMinor,
      source: "rateTable"
    };
  }

  calculate(
    taxableAmountMinor: number,
    rateBps: number,
    totalAmountMinor: number
  ): { tdsAmountMinor: number; netPayableMinor: number } {
    const tdsAmountMinor = Math.round(taxableAmountMinor * rateBps / 10000);
    const netPayableMinor = totalAmountMinor - tdsAmountMinor;
    return { tdsAmountMinor, netPayableMinor };
  }

  determineTaxableAmount(invoice: ParsedInvoiceData): number {
    const totalAmount = invoice.totalAmountMinor ?? 0;
    const gst = invoice.gst;
    if (!gst) return totalAmount;

    if (isGstShownSeparately(gst)) {
      const totalGst = totalGstMinor(gst);
      const taxableBase = gst.subtotalMinor && gst.subtotalMinor > 0
        ? gst.subtotalMinor
        : totalAmount - totalGst;
      return Math.max(taxableBase, 0);
    }

    if (gst.subtotalMinor && gst.subtotalMinor > 0) {
      return gst.subtotalMinor;
    }
    return totalAmount;
  }

  computeTds(input: ComputeTdsInput): TdsCalculationResult {
    const { invoice, glCategory, rateLookup, detection, cumulative, vendorCert, now } = input;
    const evaluatedNow = now ?? new Date();
    const riskSignals: ComplianceRiskSignal[] = [];
    const panCategory = this.getPanCategory(invoice.pan);
    const panValid = invoice.pan ? PAN_FORMAT.test(invoice.pan.toUpperCase()) : false;

    if (!detection.section) {
      return {
        tds: emptyTds(null, TDS_CONFIDENCE.LOW),
        riskSignals,
        ledgerDelta: emptyDelta()
      };
    }

    if (detection.confidence === TDS_CONFIDENCE.MEDIUM) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_SECTION_AMBIGUOUS,
        "compliance",
        "warning",
        `Multiple TDS sections could apply for category "${glCategory}" — verify section ${detection.section}.`,
        4
      ));
    }

    if (!rateLookup) {
      return {
        tds: emptyTds(detection.section, detection.confidence),
        riskSignals,
        ledgerDelta: emptyDelta()
      };
    }

    const taxableAmount = this.determineTaxableAmount(invoice);
    const totalAmount = invoice.totalAmountMinor ?? taxableAmount;

    const invoiceDate = invoice.invoiceDate ?? evaluatedNow;
    const invoiceFy = determineFY(invoiceDate);
    const quarter: TdsQuarter = determineQuarter(invoiceDate);

    const previousCumulative = cumulative?.cumulativeBaseMinor ?? 0;
    const { effectiveRateBps, rateSource, certApplied } = resolveEffectiveRate({
      panValid,
      pan: invoice.pan,
      rateLookup,
      vendorCert,
      cumulativeBaseMinor: previousCumulative,
      invoiceFy,
      now: evaluatedNow
    });

    if (certApplied) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_SECTION_197_APPLIED,
        "compliance",
        "info",
        `Section 197 certificate applied for section ${detection.section} at ${effectiveRateBps / 100}%.`,
        0
      ));
    }

    if (rateSource === TDS_RATE_SOURCE.NO_PAN_206AA) {
      const message = invoice.pan
        ? `No valid PAN — TDS at penalty rate ${effectiveRateBps / 100}% (Section 206AA) instead of ${rateLookup.rateBps / 100}%.`
        : `No PAN available — TDS at penalty rate ${effectiveRateBps / 100}% (Section 206AA).`;
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE,
        "compliance",
        "critical",
        message,
        10
      ));
    }

    if (taxableAmount <= 0) {
      return {
        tds: {
          ...emptyTds(detection.section, detection.confidence, effectiveRateBps, rateSource)
        },
        riskSignals,
        ledgerDelta: emptyDelta(effectiveRateBps, rateSource)
      };
    }

    const threshold = computeThresholdAndTds({
      taxableAmount,
      totalAmount,
      effectiveRateBps,
      rateLookup,
      cumulative,
      section: detection.section
    });
    riskSignals.push(...threshold.signals);

    const currentFy = determineFY(evaluatedNow);
    if (invoiceFy !== currentFy) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_BACKDATED_THRESHOLD_ADJUSTMENT,
        "compliance",
        "warning",
        `Backdated invoice (FY ${invoiceFy}) processed in current FY (${currentFy}).`,
        5
      ));
    }

    return {
      tds: {
        section: detection.section,
        rate: effectiveRateBps,
        rateBps: effectiveRateBps,
        rateSource,
        amountMinor: threshold.tdsAmountMinor,
        taxableBaseMinor: taxableAmount,
        netPayableMinor: threshold.netPayableMinor,
        source: TDS_SOURCE.AUTO,
        confidence: detection.confidence,
        quarter
      },
      riskSignals,
      ledgerDelta: {
        taxableAmountMinor: taxableAmount,
        tdsAmountMinor: threshold.tdsAmountMinor,
        rateBps: effectiveRateBps,
        rateSource,
        thresholdJustCrossed: threshold.thresholdJustCrossed
      }
    };
  }
}
