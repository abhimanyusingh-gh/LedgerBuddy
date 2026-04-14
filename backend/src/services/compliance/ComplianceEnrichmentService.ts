import type { ParsedInvoiceData } from "../../types/invoice.js";
import type { ComplianceRiskSignal } from "../../types/invoice.js";
import { TenantComplianceConfigModel } from "../../models/integration/TenantComplianceConfig.js";
import { TenantTcsConfigModel } from "../../models/integration/TenantTcsConfig.js";
import { logger } from "../../utils/logger.js";
import type { ComplianceEnricher, ComplianceEnrichContext, ComplianceResult } from "./ComplianceEnricher.js";
import { emptyComplianceResult } from "./ComplianceEnricher.js";
import { PanValidationService } from "./PanValidationService.js";
import { VendorMasterService } from "./VendorMasterService.js";
import { TdsCalculationService } from "./TdsCalculationService.js";
import { GlCodeSuggestionService } from "./GlCodeSuggestionService.js";
import { GlCodeMasterModel } from "../../models/compliance/GlCodeMaster.js";
import { IrnValidationService } from "./IrnValidationService.js";
import { MsmeTrackingService } from "./MsmeTrackingService.js";
import { DuplicateInvoiceDetector } from "./DuplicateInvoiceDetector.js";
import { CostCenterService } from "./CostCenterService.js";

interface ComplianceEnrichmentDeps {
  panValidation: PanValidationService;
  vendorMaster: VendorMasterService;
  tdsCalculation: TdsCalculationService;
  glCodeSuggestion: GlCodeSuggestionService;
  irnValidation: IrnValidationService;
  msmeTracking: MsmeTrackingService;
  duplicateDetector: DuplicateInvoiceDetector;
  costCenter: CostCenterService;
}

export class ComplianceEnrichmentService implements ComplianceEnricher {
  private readonly panValidation: PanValidationService;
  private readonly vendorMaster: VendorMasterService;
  private readonly tdsCalculation: TdsCalculationService;
  private readonly glCodeSuggestion: GlCodeSuggestionService;
  private readonly irnValidation: IrnValidationService;
  private readonly msmeTracking: MsmeTrackingService;
  private readonly duplicateDetector: DuplicateInvoiceDetector;
  private readonly costCenter: CostCenterService;

  constructor(deps: ComplianceEnrichmentDeps) {
    this.panValidation = deps.panValidation;
    this.vendorMaster = deps.vendorMaster;
    this.tdsCalculation = deps.tdsCalculation;
    this.glCodeSuggestion = deps.glCodeSuggestion;
    this.irnValidation = deps.irnValidation;
    this.msmeTracking = deps.msmeTracking;
    this.duplicateDetector = deps.duplicateDetector;
    this.costCenter = deps.costCenter;
  }

  async enrich(
    invoice: ParsedInvoiceData,
    tenantId: string,
    vendorFingerprint: string,
    context?: ComplianceEnrichContext
  ): Promise<ComplianceResult> {
    const config = await TenantComplianceConfigModel.findOne({ tenantId }).lean();
    const anyEnabled = config?.complianceEnabled ||
      config?.tdsEnabled ||
      config?.riskSignalsEnabled ||
      config?.panValidationEnabled;
    if (!config || !anyEnabled) {
      return emptyComplianceResult();
    }

    const result: ComplianceResult = { riskSignals: [] };
    const riskSignals: ComplianceRiskSignal[] = [];
    const processingIssues: string[] = [];

    try {
      if (config.panValidationEnabled !== false) {
        const panResult = this.panValidation.validate(invoice.pan, invoice.gst?.gstin);
        result.pan = panResult.pan;
        riskSignals.push(...panResult.riskSignals);
      }
    } catch (error) {
      processingIssues.push(`Compliance: PAN validation failed — ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("compliance.pan.validation.failed", {
        tenantId, vendorFingerprint,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const vendorName = invoice.vendorName ?? "Unknown";
      const emailDomain = undefined;

      await this.vendorMaster.upsertFromInvoice(tenantId, vendorFingerprint, {
        vendorName,
        pan: invoice.pan,
        gstin: invoice.gst?.gstin,
        bankAccountNumber: invoice.bankAccountNumber,
        bankIfsc: invoice.bankIfsc,
        emailDomain
      });

      const bankChange = await this.vendorMaster.detectBankChange(
        tenantId, vendorFingerprint, invoice.bankAccountNumber, invoice.bankIfsc
      );

      result.vendorBank = {
        accountHash: bankChange.accountHash,
        ifsc: invoice.bankIfsc ?? null,
        bankName: bankChange.bankName,
        isChanged: bankChange.isChanged,
        verifiedChange: false
      };

      if (bankChange.isChanged) {
        riskSignals.push({
          code: "VENDOR_BANK_CHANGED",
          category: "fraud",
          severity: "critical",
          message: `Vendor bank account changed. Previous bank: ${bankChange.bankName ?? "unknown"}.`,
          confidencePenalty: 10,
          status: "open",
          resolvedBy: null,
          resolvedAt: null
        });
      }
    } catch (error) {
      processingIssues.push(`Compliance: Vendor master upsert failed — ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("compliance.vendor.master.failed", {
        tenantId, vendorFingerprint,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      if (config.autoSuggestGlCodes !== false) {
        const slmGlCategory = context?.slmGlCategory;
        const glSuggestion = await this.glCodeSuggestion.suggest(tenantId, vendorFingerprint, invoice, undefined, slmGlCategory);
        result.glCode = glSuggestion.glCode;
      }
    } catch (error) {
      processingIssues.push(`Compliance: GL code suggestion failed — ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("compliance.gl.suggestion.failed", {
        tenantId, vendorFingerprint,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const ccSuggestion = await this.costCenter.suggest(tenantId, vendorFingerprint, result.glCode?.code ?? null);
      result.costCenter = ccSuggestion.costCenter;
    } catch (error) {
      processingIssues.push(`Compliance: Cost center suggestion failed — ${error instanceof Error ? error.message : String(error)}`);
    }

    const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
    if (tcsConfig?.enabled && tcsConfig.ratePercent > 0 && invoice.totalAmountMinor && invoice.totalAmountMinor > 0) {
      const tcsAmount = Math.floor(invoice.totalAmountMinor * tcsConfig.ratePercent / 100);
      result.tcs = {
        rate: tcsConfig.ratePercent,
        amountMinor: tcsAmount,
        source: "configured"
      };
    }

    try {
      if (config.tdsEnabled !== false && config.autoDetectTds !== false) {
        const glCode = result.glCode?.code ?? null;
        let glCategory: string | null = null;
        if (glCode) {
          const glDoc = await GlCodeMasterModel.findOne({ tenantId, code: glCode, isActive: true }).lean();
          glCategory = glDoc?.category ?? result.glCode?.name ?? null;
        }
        const tdsResult = await this.tdsCalculation.computeTds(invoice, tenantId, glCategory);
        result.tds = tdsResult.tds;
        riskSignals.push(...tdsResult.riskSignals);
      }
    } catch (error) {
      processingIssues.push(`Compliance: TDS calculation failed — ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("compliance.tds.calculation.failed", {
        tenantId, vendorFingerprint,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      const irnResult = this.irnValidation.validate(
        (invoice as Record<string, unknown>).irn as string | undefined,
        invoice.gst?.gstin,
        invoice.totalAmountMinor
      );
      result.irn = irnResult.irn;
      riskSignals.push(...irnResult.riskSignals);
    } catch (error) {
      processingIssues.push(`Compliance: IRN validation failed — ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const msmeResult = await this.msmeTracking.checkAndUpdate(
        tenantId,
        vendorFingerprint,
        (invoice as Record<string, unknown>).udyamNumber as string | undefined,
        invoice.invoiceDate
      );
      result.msme = msmeResult.msme;
      riskSignals.push(...msmeResult.riskSignals);
    } catch (error) {
      processingIssues.push(`Compliance: MSME tracking failed — ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const emailFrom = context?.emailFrom;
      if (emailFrom) {
        const domain = emailFrom.split("@")[1]?.toLowerCase();
        if (domain) {
          const vendor = await this.vendorMaster.findByFingerprint(tenantId, vendorFingerprint);
          if (vendor && vendor.emailDomains && vendor.emailDomains.length > 0) {
            const knownDomains = new Set(vendor.emailDomains.map((d: string) => d.toLowerCase()));
            if (!knownDomains.has(domain)) {
              const freemailDomains = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"]);
              if (freemailDomains.has(domain) && vendor.emailDomains.some((d: string) => !freemailDomains.has(d.toLowerCase()))) {
                riskSignals.push({
                  code: "SENDER_FREEMAIL",
                  category: "fraud",
                  severity: "warning",
                  message: `Invoice from freemail provider (${domain}) but vendor previously used corporate email.`,
                  confidencePenalty: 4,
                  status: "open",
                  resolvedBy: null,
                  resolvedAt: null
                });
              } else {
                riskSignals.push({
                  code: "SENDER_DOMAIN_MISMATCH",
                  category: "fraud",
                  severity: "warning",
                  message: `Sender domain "${domain}" doesn't match vendor's known domains: ${vendor.emailDomains.join(", ")}.`,
                  confidencePenalty: 4,
                  status: "open",
                  resolvedBy: null,
                  resolvedAt: null
                });
              }
            }
          } else if (!vendor || !vendor.emailDomains || vendor.emailDomains.length === 0) {
            riskSignals.push({
              code: "SENDER_FIRST_TIME",
              category: "fraud",
              severity: "info",
              message: `First invoice from email domain "${domain}" for this vendor.`,
              confidencePenalty: 0,
              status: "open",
              resolvedBy: null,
              resolvedAt: null
            });
          }
        }
      }
    } catch (error) {
      processingIssues.push(`Compliance: Email sender detection failed — ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const dupSignals = await this.duplicateDetector.check(
        tenantId,
        invoice.vendorName,
        invoice.invoiceNumber,
        context?.contentHash
      );
      riskSignals.push(...dupSignals);
    } catch (error) {
      processingIssues.push(`Compliance: Duplicate detection failed — ${error instanceof Error ? error.message : String(error)}`);
    }

    if (config.riskSignalsEnabled === false) {
      result.riskSignals = [];
    } else {
      result.riskSignals = filterSignalsByConfig(riskSignals, config);
    }

    if (processingIssues.length > 0) {
      logger.info("compliance.enrichment.partial", {
        tenantId, vendorFingerprint,
        issueCount: processingIssues.length,
        signalCount: result.riskSignals?.length ?? 0
      });
    }

    return result;
  }
}

function filterSignalsByConfig(
  signals: ComplianceRiskSignal[],
  config: { activeRiskSignals?: string[]; disabledSignals?: string[]; signalSeverityOverrides?: Map<string, string> | Record<string, string> }
): ComplianceRiskSignal[] {
  const disabled = new Set(config.disabledSignals ?? []);
  const active = config.activeRiskSignals && config.activeRiskSignals.length > 0
    ? new Set(config.activeRiskSignals)
    : null;
  const overrides = config.signalSeverityOverrides instanceof Map
    ? Object.fromEntries(config.signalSeverityOverrides)
    : (config.signalSeverityOverrides ?? {});

  return signals
    .filter(s => !disabled.has(s.code))
    .filter(s => !active || active.has(s.code))
    .map(s => {
      const override = overrides[s.code];
      if (override && (override === "info" || override === "warning" || override === "critical")) {
        return { ...s, severity: override };
      }
      return s;
    });
}
