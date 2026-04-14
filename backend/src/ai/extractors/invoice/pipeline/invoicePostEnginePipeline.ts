import { ComposablePipeline } from "@/core/pipeline/index.js";
import type { PipelineContext } from "@/core/pipeline/index.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import type { PipelineExtractionResult } from "../InvoiceExtractionPipeline.js";
import { POST_ENGINE_CTX } from "./postEngineContextKeys.js";

import { MergeBaselineWithSlmStep } from "./steps/MergeBaselineWithSlmStep.js";
import { RecoverOcrFieldsStep } from "./steps/RecoverOcrFieldsStep.js";
import { ValidateFieldsStep } from "./steps/ValidateFieldsStep.js";
import { ComputeFieldDiagnosticsStep } from "./steps/ComputeFieldDiagnosticsStep.js";
import { EnrichComplianceStep } from "./steps/EnrichComplianceStep.js";
import { AssessConfidenceStep } from "./steps/AssessConfidenceStep.js";
import { ResolveProvenanceStep } from "./steps/ResolveProvenanceStep.js";
import { BuildExtractionResultStep } from "./steps/BuildExtractionResultStep.js";

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
    .add(new MergeBaselineWithSlmStep())          // Stage 9
    .add(new RecoverOcrFieldsStep())               // Stage 10
    .add(new ValidateFieldsStep())                 // Stage 11
    .add(new ComputeFieldDiagnosticsStep())        // Stage 12
    .add(new EnrichComplianceStep(deps.complianceEnricher)) // Stage 13
    .add(new AssessConfidenceStep())               // Stage 14
    .add(new ResolveProvenanceStep())              // Stage 15
    .add(new BuildExtractionResultStep());         // Stage 16

  return pipeline;
}
