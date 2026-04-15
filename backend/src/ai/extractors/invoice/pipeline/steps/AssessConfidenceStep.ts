import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData, InvoiceCompliance } from "@/types/invoice.js";
import { assessInvoiceConfidence, type ConfidenceTenantConfig } from "@/services/invoice/confidenceAssessment.js";
import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";
import { resolveTenantComplianceConfig } from "@/services/compliance/tenantConfigResolver.js";
import type { UUID } from "@/types/uuid.js";

export class AssessConfidenceStep implements PipelineStep {
  readonly name = "assess-confidence";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const ocrConfidence = ctx.store.get<number>("invoice.ocrConfidence");
    const compliance = ctx.store.get<InvoiceCompliance>(POST_ENGINE_CTX.COMPLIANCE);
    const tenantId = ctx.input.tenantId as UUID;

    const tenantConfig = await resolveTenantComplianceConfig(tenantId);

    const penaltyCap = tenantConfig?.riskSignalPenaltyCap;
    const penalty = compliance?.riskSignals?.length
      ? RiskSignalEvaluator.sumPenalties(compliance.riskSignals, penaltyCap)
      : 0;

    const confidenceConfig: ConfidenceTenantConfig | undefined = tenantConfig
      ? {
          ocrWeight: tenantConfig.ocrWeight,
          completenessWeight: tenantConfig.completenessWeight,
          warningPenalty: tenantConfig.warningPenalty,
          warningPenaltyCap: tenantConfig.warningPenaltyCap,
          requiredFields: tenantConfig.requiredFields,
        }
      : undefined;

    const confidence = assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings: ctx.issues,
      complianceRiskPenalty: penalty,
      autoApprovalThreshold: tenantConfig?.autoApprovalThreshold ?? undefined,
      tenantConfig: confidenceConfig,
    });

    ctx.store.set(POST_ENGINE_CTX.CONFIDENCE_ASSESSMENT, confidence);
    return {};
  }
}
