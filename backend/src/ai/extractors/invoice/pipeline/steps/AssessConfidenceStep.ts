import type { PipelineContext, PipelineStep, StepOutput } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData, InvoiceCompliance } from "@/types/invoice.js";
import { assessInvoiceConfidence } from "@/services/invoice/confidenceAssessment.js";
import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";

export class AssessConfidenceStep implements PipelineStep {
  readonly name = "assess-confidence";

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const ocrConfidence = ctx.store.get<number>("invoice.ocrConfidence");
    const compliance = ctx.store.get<InvoiceCompliance>(POST_ENGINE_CTX.COMPLIANCE);

    const penalty = compliance?.riskSignals?.length
      ? RiskSignalEvaluator.sumPenalties(compliance.riskSignals)
      : 0;

    const confidence = assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings: ctx.issues,
      complianceRiskPenalty: penalty,
    });

    ctx.store.set(POST_ENGINE_CTX.CONFIDENCE_ASSESSMENT, confidence);
    return {};
  }
}
