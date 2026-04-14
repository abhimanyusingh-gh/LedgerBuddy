import type { PipelineContext, PipelineStage, StageResult } from "@/core/pipeline/index.js";
import type { ParsedInvoiceData, InvoiceCompliance } from "@/types/invoice.js";
import { assessInvoiceConfidence } from "@/services/invoice/confidenceAssessment.js";
import { RiskSignalEvaluator } from "@/services/compliance/RiskSignalEvaluator.js";
import { POST_ENGINE_CTX } from "../postEngineContextKeys.js";

/**
 * Stage 14: Assesses overall extraction confidence, applying risk signal penalties
 * from compliance enrichment. Wraps `assessInvoiceConfidence()`.
 */
export class AssessConfidenceStep implements PipelineStage {
  readonly name = "assess-confidence";

  async execute(ctx: PipelineContext): Promise<StageResult> {
    const parsed = ctx.store.require<ParsedInvoiceData>(POST_ENGINE_CTX.RECOVERED_PARSED);
    const ocrConfidence = ctx.store.get<number>("invoice.ocrConfidence");
    const compliance = ctx.store.get<InvoiceCompliance>(POST_ENGINE_CTX.COMPLIANCE);
    const expectedMaxTotal = (ctx.input as Record<string, unknown>).expectedMaxTotal as number ?? 0;
    const expectedMaxDueDays = (ctx.input as Record<string, unknown>).expectedMaxDueDays as number ?? 0;
    const autoSelectMin = (ctx.input as Record<string, unknown>).autoSelectMin as number ?? 0;
    const referenceDate = (ctx.input as Record<string, unknown>).referenceDate as Date | undefined;

    const penalty = compliance?.riskSignals?.length
      ? RiskSignalEvaluator.sumPenalties(compliance.riskSignals)
      : 0;

    const confidence = assessInvoiceConfidence({
      ocrConfidence,
      parsed,
      warnings: ctx.issues,
      expectedMaxTotal,
      expectedMaxDueDays,
      autoSelectMin,
      referenceDate,
      complianceRiskPenalty: penalty,
    });

    ctx.store.set(POST_ENGINE_CTX.CONFIDENCE_ASSESSMENT, confidence);
    return {};
  }
}
