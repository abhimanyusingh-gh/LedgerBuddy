import type { Types } from "mongoose";
import { PAN_FORMAT, derivePanCategory } from "@/constants/indianCompliance.js";
import { TdsRateTableModel } from "@/models/compliance/TdsRateTable.js";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping.js";
import { resolveTdsRatesConfig } from "@/services/compliance/clientConfigResolver.js";
import type { ComplianceTdsResult, ComplianceRiskSignal, ParsedInvoiceData } from "@/types/invoice.js";
import { TDS_CONFIDENCE, type TdsConfidence } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
import { RISK_SIGNAL_CODE } from "@/types/riskSignals.js";

interface TdsDetectionResult {
  section: string | null;
  confidence: TdsConfidence;
}

interface TdsRateLookup {
  rateBps: number;
  thresholdSingleMinor: number;
  thresholdAnnualMinor: number;
}

interface TdsCalculationResult {
  tds: ComplianceTdsResult;
  riskSignals: ComplianceRiskSignal[];
}

interface PanCategoryRates {
  noPan: number;
  company: number;
  individual: number;
}

function selectRateByPanCategory(panCategory: string | null, rates: PanCategoryRates): number {
  if (!panCategory) return rates.noPan;
  if (panCategory === "C") return rates.company;
  return rates.individual;
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
            thresholdAnnualMinor: 0
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
      thresholdAnnualMinor: rate.thresholdAnnualMinor
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
    if (invoice.gst?.subtotalMinor && invoice.gst.subtotalMinor > 0) {
      return invoice.gst.subtotalMinor;
    }
    return invoice.totalAmountMinor ?? 0;
  }

  async computeTds(
    invoice: ParsedInvoiceData,
    tenantId: string,
    clientOrgId: Types.ObjectId,
    glCategory: string | null
  ): Promise<TdsCalculationResult> {
    const riskSignals: ComplianceRiskSignal[] = [];
    const panCategory = this.getPanCategory(invoice.pan);
    const panValid = invoice.pan ? PAN_FORMAT.test(invoice.pan.toUpperCase()) : false;

    const detection = await this.detectSection(panCategory, glCategory, tenantId, clientOrgId);

    if (!detection.section) {
      return {
        tds: {
          section: null,
          rate: null,
          amountMinor: null,
          netPayableMinor: null,
          source: "auto",
          confidence: TDS_CONFIDENCE.LOW
        },
        riskSignals
      };
    }

    if (detection.confidence === TDS_CONFIDENCE.MEDIUM) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_SECTION_AMBIGUOUS,
        "compliance",
        "warning",
        `Multiple TDS sections could apply for category "${glCategory}" — please verify section ${detection.section}.`,
        4
      ));
    }

    const rateLookup = await this.lookupRate(detection.section, panCategory, tenantId, clientOrgId);
    if (!rateLookup) {
      return {
        tds: {
          section: detection.section,
          rate: null,
          amountMinor: null,
          netPayableMinor: null,
          source: "auto",
          confidence: detection.confidence
        },
        riskSignals
      };
    }

    if (!panValid && invoice.pan !== undefined && invoice.pan !== null) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE,
        "compliance",
        "critical",
        `No valid PAN — TDS at 20% penalty rate (Section 206AA) applies instead of ${rateLookup.rateBps / 100}%.`,
        10
      ));
    } else if (!invoice.pan) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_NO_PAN_PENALTY_RATE,
        "compliance",
        "critical",
        "No PAN available — TDS at 20% penalty rate (Section 206AA) applies.",
        10
      ));
    }

    const taxableAmount = this.determineTaxableAmount(invoice);
    const totalAmount = invoice.totalAmountMinor ?? taxableAmount;

    if (taxableAmount <= 0) {
      return {
        tds: {
          section: detection.section,
          rate: rateLookup.rateBps,
          amountMinor: null,
          netPayableMinor: null,
          source: "auto",
          confidence: detection.confidence
        },
        riskSignals
      };
    }

    if (rateLookup.thresholdSingleMinor > 0 && taxableAmount < rateLookup.thresholdSingleMinor) {
      riskSignals.push(createRiskSignal(
        RISK_SIGNAL_CODE.TDS_BELOW_THRESHOLD,
        "compliance",
        "info",
        `Invoice amount below single-transaction TDS threshold for section ${detection.section}.`,
        0
      ));

      return {
        tds: {
          section: detection.section,
          rate: rateLookup.rateBps,
          amountMinor: 0,
          netPayableMinor: totalAmount,
          source: "auto",
          confidence: detection.confidence
        },
        riskSignals
      };
    }

    const { tdsAmountMinor, netPayableMinor } = this.calculate(taxableAmount, rateLookup.rateBps, totalAmount);

    return {
      tds: {
        section: detection.section,
        rate: rateLookup.rateBps,
        amountMinor: tdsAmountMinor,
        netPayableMinor,
        source: "auto",
        confidence: detection.confidence
      },
      riskSignals
    };
  }
}
