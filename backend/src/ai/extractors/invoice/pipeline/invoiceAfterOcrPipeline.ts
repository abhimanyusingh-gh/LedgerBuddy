import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { InvoiceDocumentDefinition } from "@/ai/extractors/invoice/InvoiceDocumentDefinition.js";
import type { VendorTemplateSnapshot } from "@/ai/extractors/invoice/learning/vendorTemplateStore.js";
import { CaptureOcrMetadataStep } from "@/ai/extractors/commonSteps/CaptureOcrMetadataStep.js";
import { PostProcessOcrStep } from "@/ai/extractors/commonSteps/PostProcessOcrStep.js";
import { BuildTextCandidatesStep } from "@/ai/extractors/commonSteps/BuildTextCandidatesStep.js";
import { CalibrateConfidenceStep } from "@/ai/extractors/commonSteps/CalibrateConfidenceStep.js";
import { DetectLanguageStep } from "@/ai/extractors/commonSteps/DetectLanguageStep.js";
import { CheckExtractFieldsGateStep } from "@/ai/extractors/invoice/pipeline/steps/CheckExtractFieldsGateStep.js";
import { BaselineTextParseStep } from "@/ai/extractors/invoice/pipeline/steps/BaselineTextParseStep.js";
import { AugmentPromptBuilderStep } from "@/ai/extractors/invoice/pipeline/steps/AugmentPromptBuilderStep.js";

interface AfterOcrPipelineParams {
  definition: InvoiceDocumentDefinition;
  enableKeyValueGrounding: boolean;
  template?: VendorTemplateSnapshot;
  llamaExtractEnabled?: boolean;
}

export function buildInvoiceAfterOcrPipeline(
  params: AfterOcrPipelineParams,
): ComposablePipeline<void> {
  return new ComposablePipeline<void>(() => undefined)
    .add(new CaptureOcrMetadataStep())                            // Stage 1
    .add(new PostProcessOcrStep())                                // Stage 2
    .add(new BuildTextCandidatesStep(params.enableKeyValueGrounding)) // Stage 3
    .add(new CalibrateConfidenceStep())                           // Stage 4
    .add(new DetectLanguageStep())                                // Stage 5
    .add(new CheckExtractFieldsGateStep(params.llamaExtractEnabled ?? false)) // Gate
    .add(new BaselineTextParseStep(params.template))              // Stage 6
    .add(new AugmentPromptBuilderStep(params.definition));        // Stage 7
}
