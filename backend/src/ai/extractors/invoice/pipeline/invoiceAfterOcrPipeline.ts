import { ComposablePipeline } from "@/core/pipeline/ComposablePipeline.js";
import type { InvoiceDocumentDefinition } from "../InvoiceDocumentDefinition.js";
import type { VendorTemplateSnapshot } from "../learning/vendorTemplateStore.js";
import { CaptureOcrMetadataStage } from "./stages/CaptureOcrMetadataStage.js";
import { PostProcessOcrStage } from "./stages/PostProcessOcrStage.js";
import { BuildTextCandidatesStage } from "./stages/BuildTextCandidatesStage.js";
import { CalibrateConfidenceStage } from "./stages/CalibrateConfidenceStage.js";
import { DetectLanguageStage } from "./stages/DetectLanguageStage.js";
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
}

export function buildInvoiceAfterOcrPipeline(
  params: AfterOcrPipelineParams,
): ComposablePipeline<void> {
  return new ComposablePipeline<void>(() => undefined)
    .add(new CaptureOcrMetadataStage())
    .add(new PostProcessOcrStage())
    .add(new BuildTextCandidatesStage(params.enableKeyValueGrounding))
    .add(new CalibrateConfidenceStage())
    .add(new DetectLanguageStage())
    .add(new BaselineTextParseStage(params.template))
    .add(new AugmentPromptBuilderStage(params.definition))
    .add(new SetValidationContextStage(params.definition, {
      expectedMaxTotal: params.expectedMaxTotal,
      expectedMaxDueDays: params.expectedMaxDueDays,
      referenceDate: params.referenceDate,
    }));
}
