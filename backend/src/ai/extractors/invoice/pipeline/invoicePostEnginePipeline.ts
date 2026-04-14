import { ComposablePipeline } from "@/core/pipeline/index.js";
import type { PipelineContext } from "@/core/pipeline/index.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import type { PipelineExtractionResult } from "../InvoiceExtractionPipeline.js";
import { POST_ENGINE_CTX } from "./postEngineContextKeys.js";

import { MergeBaselineWithSlmStage } from "./stages/MergeBaselineWithSlmStage.js";
import { RecoverOcrFieldsStage } from "./stages/RecoverOcrFieldsStage.js";
import { ValidateFieldsStage } from "./stages/ValidateFieldsStage.js";
import { ComputeFieldDiagnosticsStage } from "./stages/ComputeFieldDiagnosticsStage.js";
import { EnrichComplianceStage } from "./stages/EnrichComplianceStage.js";
import { AssessConfidenceStage } from "./stages/AssessConfidenceStage.js";
import { ResolveProvenanceStage } from "./stages/ResolveProvenanceStage.js";
import { BuildExtractionResultStage } from "./stages/BuildExtractionResultStage.js";

export interface PostEnginePipelineDeps {
  complianceEnricher?: ComplianceEnricher;
}

/**
 * Creates a composable pipeline for stages 9-16: all post-engine processing
 * that transforms the raw SLM output into a final PipelineExtractionResult.
 *
 * Prerequisites in the context store (set by pre-engine stages 1-8):
 * - "invoice.baselineParsed": ParsedInvoiceData (baseline heuristic parse)
 * - "invoice.ocrBlocks": OcrBlock[]
 * - "invoice.ocrPageImages": OcrPageImage[]
 * - "invoice.primaryText": string (primary OCR text candidate)
 * - "invoice.ocrConfidence": number
 * - "invoice.ocrTokens": number
 * - "invoice.ocrProviderName": string
 * - "invoice.fieldRegions": Record<string, OcrBlock[]>
 * - POST_ENGINE_CTX.SLM_OUTPUT: InvoiceSlmOutput
 *
 * Pipeline input must include: expectedMaxTotal, expectedMaxDueDays, autoSelectMin, referenceDate?
 */
export function createInvoicePostEnginePipeline(
  deps: PostEnginePipelineDeps = {},
): ComposablePipeline<PipelineExtractionResult> {
  const pipeline = new ComposablePipeline<PipelineExtractionResult>(
    (ctx: PipelineContext) => ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT),
  );

  pipeline
    .add(new MergeBaselineWithSlmStage())          // Stage 9
    .add(new RecoverOcrFieldsStage())               // Stage 10
    .add(new ValidateFieldsStage())                 // Stage 11
    .add(new ComputeFieldDiagnosticsStage())        // Stage 12
    .add(new EnrichComplianceStage(deps.complianceEnricher)) // Stage 13
    .add(new AssessConfidenceStage())               // Stage 14
    .add(new ResolveProvenanceStage())              // Stage 15
    .add(new BuildExtractionResultStage());         // Stage 16

  return pipeline;
}
