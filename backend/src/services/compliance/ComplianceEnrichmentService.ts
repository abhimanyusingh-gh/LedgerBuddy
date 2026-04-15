import type { ParsedInvoiceData } from "@/types/invoice.js";
import type { ComplianceRiskSignal } from "@/types/invoice.js";
import { createRiskSignal } from "@/services/compliance/riskSignalFactory.js";
import { TenantComplianceConfigModel } from "@/models/integration/TenantComplianceConfig.js";
import { TenantTcsConfigModel } from "@/models/integration/TenantTcsConfig.js";
import { logger } from "@/utils/logger.js";
import type { ComplianceEnricher, ComplianceEnrichContext, ComplianceResult } from "@/services/compliance/ComplianceEnricher.js";
import { emptyComplianceResult } from "@/services/compliance/ComplianceEnricher.js";
import { PanValidationService } from "@/services/compliance/PanValidationService.js";
import { VendorMasterService } from "@/services/compliance/VendorMasterService.js";
import { TdsCalculationService } from "@/services/compliance/TdsCalculationService.js";
import { GlCodeSuggestionService } from "@/services/compliance/GlCodeSuggestionService.js";
import { GlCodeMasterModel } from "@/models/compliance/GlCodeMaster.js";
import { IrnValidationService } from "@/services/compliance/IrnValidationService.js";
import { MsmeTrackingService } from "@/services/compliance/MsmeTrackingService.js";
import { DuplicateInvoiceDetector } from "@/services/compliance/DuplicateInvoiceDetector.js";
import { CostCenterService } from "@/services/compliance/CostCenterService.js";

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

    this.enrichPan(invoice, config, result, riskSignals, processingIssues, tenantId, vendorFingerprint);
    await this.enrichVendorMaster(invoice, tenantId, vendorFingerprint, result, riskSignals, processingIssues);
    await this.enrichGlCode(invoice, config, tenantId, vendorFingerprint, context, result, processingIssues);
    await this.enrichCostCenter(tenantId, vendorFingerprint, result, processingIssues);
    await this.enrichTcs(invoice, tenantId, result);
    await this.enrichTds(invoice, config, tenantId, vendorFingerprint, result, riskSignals, processingIssues);
    this.enrichIrn(invoice, config, result, riskSignals, processingIssues);
    await this.enrichMsme(invoice, config, tenantId, vendorFingerprint, result, riskSignals, processingIssues);
    await this.enrichEmailSender(tenantId, vendorFingerprint, context, riskSignals, processingIssues);
    await this.enrichDuplicateDetection(invoice, tenantId, context, riskSignals, processingIssues);

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

  private enrichPan(
    invoice: ParsedInvoiceData,
    config: Record<string, unknown>,
    result: ComplianceResult,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[],
    tenantId: string,
    vendorFingerprint: string
  ): void {
    try {
      if ((config as Record<string, unknown>).panValidationEnabled !== false) {
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
  }

  private async enrichVendorMaster(
    invoice: ParsedInvoiceData,
    tenantId: string,
    vendorFingerprint: string,
    result: ComplianceResult,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): Promise<void> {
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
        riskSignals.push(createRiskSignal(
          "VENDOR_BANK_CHANGED",
          "fraud",
          "critical",
          `Vendor bank account changed. Previous bank: ${bankChange.bankName ?? "unknown"}.`,
          10
        ));
      }
    } catch (error) {
      processingIssues.push(`Compliance: Vendor master upsert failed — ${error instanceof Error ? error.message : String(error)}`);
      logger.warn("compliance.vendor.master.failed", {
        tenantId, vendorFingerprint,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async enrichGlCode(
    invoice: ParsedInvoiceData,
    config: Record<string, unknown>,
    tenantId: string,
    vendorFingerprint: string,
    context: ComplianceEnrichContext | undefined,
    result: ComplianceResult,
    processingIssues: string[]
  ): Promise<void> {
    try {
      if ((config as Record<string, unknown>).autoSuggestGlCodes !== false) {
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
  }

  private async enrichCostCenter(
    tenantId: string,
    vendorFingerprint: string,
    result: ComplianceResult,
    processingIssues: string[]
  ): Promise<void> {
    try {
      const ccSuggestion = await this.costCenter.suggest(tenantId, vendorFingerprint, result.glCode?.code ?? null);
      result.costCenter = ccSuggestion.costCenter;
    } catch (error) {
      processingIssues.push(`Compliance: Cost center suggestion failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async enrichTcs(
    invoice: ParsedInvoiceData,
    tenantId: string,
    result: ComplianceResult
  ): Promise<void> {
    const tcsConfig = await TenantTcsConfigModel.findOne({ tenantId }).lean();
    if (tcsConfig?.enabled && tcsConfig.ratePercent > 0 && invoice.totalAmountMinor && invoice.totalAmountMinor > 0) {
      const tcsAmount = Math.floor(invoice.totalAmountMinor * tcsConfig.ratePercent / 100);
      result.tcs = {
        rate: tcsConfig.ratePercent,
        amountMinor: tcsAmount,
        source: "configured"
      };
    }
  }

  private async enrichTds(
    invoice: ParsedInvoiceData,
    config: Record<string, unknown>,
    tenantId: string,
    vendorFingerprint: string,
    result: ComplianceResult,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): Promise<void> {
    try {
      if ((config as Record<string, unknown>).tdsEnabled !== false && (config as Record<string, unknown>).autoDetectTds !== false) {
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
  }

  private enrichIrn(
    invoice: ParsedInvoiceData,
    config: Record<string, unknown>,
    result: ComplianceResult,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): void {
    try {
      const irnResult = this.irnValidation.validate(
        (invoice as Record<string, unknown>).irn as string | undefined,
        invoice.gst?.gstin,
        invoice.totalAmountMinor,
        { eInvoiceThresholdMinor: config.eInvoiceThresholdMinor as number | undefined }
      );
      result.irn = irnResult.irn;
      riskSignals.push(...irnResult.riskSignals);
    } catch (error) {
      processingIssues.push(`Compliance: IRN validation failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async enrichMsme(
    invoice: ParsedInvoiceData,
    config: Record<string, unknown>,
    tenantId: string,
    vendorFingerprint: string,
    result: ComplianceResult,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): Promise<void> {
    try {
      const msmeResult = await this.msmeTracking.checkAndUpdate(
        tenantId,
        vendorFingerprint,
        (invoice as Record<string, unknown>).udyamNumber as string | undefined,
        invoice.invoiceDate,
        {
          msmePaymentWarningDays: config.msmePaymentWarningDays as number | undefined,
          msmePaymentOverdueDays: config.msmePaymentOverdueDays as number | undefined,
        }
      );
      result.msme = msmeResult.msme;
      riskSignals.push(...msmeResult.riskSignals);
    } catch (error) {
      processingIssues.push(`Compliance: MSME tracking failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async enrichEmailSender(
    tenantId: string,
    vendorFingerprint: string,
    context: ComplianceEnrichContext | undefined,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): Promise<void> {
    try {
      const emailFrom = context?.emailFrom;
      if (emailFrom) {
        const domain = emailFrom.split("@")[1]?.toLowerCase();
        if (domain) {
          const vendor = await this.vendorMaster.findByFingerprint(tenantId, vendorFingerprint);
          if (vendor && vendor.emailDomains && vendor.emailDomains.length > 0) {
            const knownDomains = new Set(vendor.emailDomains.map((d: string) => d.toLowerCase()));
            if (!knownDomains.has(domain)) {
              const freemailDomains = await this.resolveFreemailDomains(tenantId);
              if (freemailDomains.has(domain) && vendor.emailDomains.some((d: string) => !freemailDomains.has(d.toLowerCase()))) {
                riskSignals.push(createRiskSignal(
                  "SENDER_FREEMAIL",
                  "fraud",
                  "warning",
                  `Invoice from freemail provider (${domain}) but vendor previously used corporate email.`,
                  4
                ));
              } else {
                riskSignals.push(createRiskSignal(
                  "SENDER_DOMAIN_MISMATCH",
                  "fraud",
                  "warning",
                  `Sender domain "${domain}" doesn't match vendor's known domains: ${vendor.emailDomains.join(", ")}.`,
                  4
                ));
              }
            }
          } else if (!vendor || !vendor.emailDomains || vendor.emailDomains.length === 0) {
            riskSignals.push(createRiskSignal(
              "SENDER_FIRST_TIME",
              "fraud",
              "info",
              `First invoice from email domain "${domain}" for this vendor.`,
              0
            ));
          }
        }
      }
    } catch (error) {
      processingIssues.push(`Compliance: Email sender detection failed — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async resolveFreemailDomains(tenantId: string): Promise<Set<string>> {
    const systemDefaults = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];
    const config = await TenantComplianceConfigModel.findOne({ tenantId })
      .select({ additionalFreemailDomains: 1 })
      .lean();
    const additional = (config as Record<string, unknown> | null)?.additionalFreemailDomains as string[] | undefined;
    if (additional && additional.length > 0) {
      return new Set([...systemDefaults, ...additional.map(d => d.toLowerCase())]);
    }
    return new Set(systemDefaults);
  }

  private async enrichDuplicateDetection(
    invoice: ParsedInvoiceData,
    tenantId: string,
    context: ComplianceEnrichContext | undefined,
    riskSignals: ComplianceRiskSignal[],
    processingIssues: string[]
  ): Promise<void> {
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
  }
}

function filterSignalsByConfig(
  signals: ComplianceRiskSignal[],
  config: {
    activeRiskSignals?: string[];
    disabledSignals?: string[];
    signalSeverityOverrides?: Map<string, string> | Record<string, string> | null;
    confidencePenaltyOverrides?: Map<string, number> | Record<string, number> | null;
  }
): ComplianceRiskSignal[] {
  const disabled = new Set(config.disabledSignals ?? []);
  const active = config.activeRiskSignals && config.activeRiskSignals.length > 0
    ? new Set(config.activeRiskSignals)
    : null;
  const severityOverrides = config.signalSeverityOverrides instanceof Map
    ? Object.fromEntries(config.signalSeverityOverrides)
    : (config.signalSeverityOverrides ?? {});
  const penaltyOverrides = config.confidencePenaltyOverrides instanceof Map
    ? Object.fromEntries(config.confidencePenaltyOverrides)
    : (config.confidencePenaltyOverrides ?? {});

  return signals
    .filter(s => !disabled.has(s.code))
    .filter(s => !active || active.has(s.code))
    .map(s => {
      let updated = s;
      const sevOverride = severityOverrides[s.code];
      if (sevOverride && (sevOverride === "info" || sevOverride === "warning" || sevOverride === "critical")) {
        updated = { ...updated, severity: sevOverride };
      }
      const penOverride = penaltyOverrides[s.code];
      if (penOverride !== undefined && typeof penOverride === "number") {
        updated = { ...updated, confidencePenalty: penOverride };
      }
      return updated;
    });
}
