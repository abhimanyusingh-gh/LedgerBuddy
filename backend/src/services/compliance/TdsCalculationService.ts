import { PAN_FORMAT, derivePanCategory } from "@/constants/indianCompliance.js";
import { TdsRateTableModel } from "@/models/compliance/TdsRateTable.js";
import { TdsSectionMappingModel } from "@/models/compliance/TdsSectionMapping.js";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig.js";
import type { ComplianceTdsResult, ComplianceRiskSignal, ParsedInvoiceData } from "@/types/invoice.js";
import { TDS_CONFIDENCE, type TdsConfidence } from "@/types/invoice.js";

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

export class TdsCalculationService {
  getPanCategory(pan: string | null | undefined): string | null {
    if (!pan || !PAN_FORMAT.test(pan.toUpperCase())) return null;
    return derivePanCategory(pan);
  }

  async detectSection(
    panCategory: string | null,
    glCategory: string | null,
    tenantId: string
  ): Promise<TdsDetectionResult> {
    if (!glCategory) {
      return { section: null, confidence: TDS_CONFIDENCE.LOW };
    }

    const effectivePanCategory = panCategory ?? "*";
    const queries = [
      { tenantId, glCategory, panCategory: effectivePanCategory },
      { tenantId, glCategory, panCategory: "*" },
      { tenantId: null, glCategory, panCategory: effectivePanCategory },
      { tenantId: null, glCategory, panCategory: "*" }
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
    tenantId?: string
  ): Promise<TdsRateLookup | null> {
    if (tenantId) {
      const tenantConfig = await TenantComplianceConfigModel.findOne({ tenantId }).lean();
      if (tenantConfig && tenantConfig.tdsRates && tenantConfig.tdsRates.length > 0) {
        const entry = tenantConfig.tdsRates.find((r) => r.section === section);
        if (entry) {
          if (!entry.active) return null;

          let rateBps: number;
          if (!panCategory) {
            rateBps = entry.rateNoPan;
          } else if (panCategory === "C") {
            rateBps = entry.rateCompany;
          } else {
            rateBps = entry.rateIndividual;
          }

          return {
            rateBps,
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

    let rateBps: number;
    if (!panCategory) {
      rateBps = rate.rateNoPanBps;
    } else if (panCategory === "C") {
      rateBps = rate.rateCompanyBps;
    } else {
      rateBps = rate.rateIndividualBps;
    }

    return {
      rateBps,
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
    glCategory: string | null
  ): Promise<TdsCalculationResult> {
    const riskSignals: ComplianceRiskSignal[] = [];
    const panCategory = this.getPanCategory(invoice.pan);
    const panValid = invoice.pan ? PAN_FORMAT.test(invoice.pan.toUpperCase()) : false;

    const detection = await this.detectSection(panCategory, glCategory, tenantId);

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
      riskSignals.push({
        code: "TDS_SECTION_AMBIGUOUS",
        category: "compliance",
        severity: "warning",
        message: `Multiple TDS sections could apply for category "${glCategory}" — please verify section ${detection.section}.`,
        confidencePenalty: 4,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });
    }

    const rateLookup = await this.lookupRate(detection.section, panCategory, tenantId);
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
      riskSignals.push({
        code: "TDS_NO_PAN_PENALTY_RATE",
        category: "compliance",
        severity: "critical",
        message: `No valid PAN — TDS at 20% penalty rate (Section 206AA) applies instead of ${rateLookup.rateBps / 100}%.`,
        confidencePenalty: 10,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });
    } else if (!invoice.pan) {
      riskSignals.push({
        code: "TDS_NO_PAN_PENALTY_RATE",
        category: "compliance",
        severity: "critical",
        message: "No PAN available — TDS at 20% penalty rate (Section 206AA) applies.",
        confidencePenalty: 10,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });
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
      riskSignals.push({
        code: "TDS_BELOW_THRESHOLD",
        category: "compliance",
        severity: "info",
        message: `Invoice amount below single-transaction TDS threshold for section ${detection.section}.`,
        confidencePenalty: 0,
        status: "open",
        resolvedBy: null,
        resolvedAt: null
      });

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
