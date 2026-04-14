import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { InvoiceDocumentDefinition } from "../InvoiceDocumentDefinition.js";
import type { VendorTemplateSnapshot } from "../learning/vendorTemplateStore.js";
import { CaptureOcrMetadataStep } from "../../commonSteps/CaptureOcrMetadataStep.js";
import { PostProcessOcrStep } from "../../commonSteps/PostProcessOcrStep.js";
import { BuildTextCandidatesStep } from "../../commonSteps/BuildTextCandidatesStep.js";
import { CalibrateConfidenceStep } from "../../commonSteps/CalibrateConfidenceStep.js";
import { DetectLanguageStep } from "../../commonSteps/DetectLanguageStep.js";
import { CheckExtractFieldsGateStep } from "./steps/CheckExtractFieldsGateStep.js";
import { BaselineTextParseStep } from "./steps/BaselineTextParseStep.js";
import { AugmentPromptBuilderStep } from "./steps/AugmentPromptBuilderStep.js";
import { SetValidationContextStep } from "./steps/SetValidationContextStep.js";

interface AfterOcrPipelineParams {
  definition: InvoiceDocumentDefinition;
  enableKeyValueGrounding: boolean;
  template?: VendorTemplateSnapshot;
  expectedMaxTotal: number;
  expectedMaxDueDays: number;
  referenceDate?: Date;
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
    .add(new AugmentPromptBuilderStep(params.definition))         // Stage 7
    .add(new SetValidationContextStep(params.definition, {        // Stage 8
      expectedMaxTotal: params.expectedMaxTotal,
      expectedMaxDueDays: params.expectedMaxDueDays,
      referenceDate: params.referenceDate,
    }));
}
