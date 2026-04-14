import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { InvoiceDocumentDefinition } from "../InvoiceDocumentDefinition.js";
import type { VendorTemplateSnapshot } from "../learning/vendorTemplateStore.js";
import { CaptureOcrMetadataStage } from "./stages/CaptureOcrMetadataStage.js";
import { PostProcessOcrStage } from "./stages/PostProcessOcrStage.js";
import { BuildTextCandidatesStage } from "./stages/BuildTextCandidatesStage.js";
import { CalibrateConfidenceStage } from "./stages/CalibrateConfidenceStage.js";
import { DetectLanguageStage } from "./stages/DetectLanguageStage.js";
import { CheckExtractFieldsGateStage } from "./stages/CheckExtractFieldsGateStage.js";
import { BaselineTextParseStage } from "./stages/BaselineTextParseStage.js";
import { AugmentPromptBuilderStage } from "./stages/AugmentPromptBuilderStage.js";
import { SetValidationContextStage } from "./stages/SetValidationContextStage.js";

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
    .add(new CaptureOcrMetadataStage())                            // Stage 1
    .add(new PostProcessOcrStage())                                // Stage 2
    .add(new BuildTextCandidatesStage(params.enableKeyValueGrounding)) // Stage 3
    .add(new CalibrateConfidenceStage())                           // Stage 4
    .add(new DetectLanguageStage())                                // Stage 5
    .add(new CheckExtractFieldsGateStage(params.llamaExtractEnabled ?? false)) // Gate
    .add(new BaselineTextParseStage(params.template))              // Stage 6
    .add(new AugmentPromptBuilderStage(params.definition))         // Stage 7
    .add(new SetValidationContextStage(params.definition, {        // Stage 8
      expectedMaxTotal: params.expectedMaxTotal,
      expectedMaxDueDays: params.expectedMaxDueDays,
      referenceDate: params.referenceDate,
    }));
}
