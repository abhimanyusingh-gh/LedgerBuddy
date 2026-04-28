import { ComposablePipeline } from "@/core/pipeline/index.js";
import type { PipelineContext } from "@/core/pipeline/index.js";
import type { ComplianceEnricher } from "@/services/compliance/ComplianceEnricher.js";
import type { PipelineExtractionResult } from "@/ai/extractors/invoice/InvoiceExtractionPipeline.js";
import { POST_ENGINE_CTX } from "@/ai/extractors/invoice/pipeline/postEngineContextKeys.js";

import { MergeBaselineWithSlmStep } from "@/ai/extractors/invoice/pipeline/steps/MergeBaselineWithSlmStep.js";
import { RecoverOcrFieldsStep } from "@/ai/extractors/invoice/pipeline/steps/RecoverOcrFieldsStep.js";
import { ValidateFieldsStep } from "@/ai/extractors/invoice/pipeline/steps/ValidateFieldsStep.js";
import { ComputeFieldDiagnosticsStep } from "@/ai/extractors/invoice/pipeline/steps/ComputeFieldDiagnosticsStep.js";
import { EnrichComplianceStep } from "@/ai/extractors/invoice/pipeline/steps/EnrichComplianceStep.js";
import { AssessConfidenceStep } from "@/ai/extractors/invoice/pipeline/steps/AssessConfidenceStep.js";
import { ResolveProvenanceStep } from "@/ai/extractors/invoice/pipeline/steps/ResolveProvenanceStep.js";
import { BuildExtractionResultStep } from "@/ai/extractors/invoice/pipeline/steps/BuildExtractionResultStep.js";

export interface PostEnginePipelineDeps {
  complianceEnricher?: ComplianceEnricher;
}

export function createInvoicePostEnginePipeline(
  deps: PostEnginePipelineDeps = {},
): ComposablePipeline<PipelineExtractionResult> {
  const pipeline = new ComposablePipeline<PipelineExtractionResult>(
    (ctx: PipelineContext) => ctx.store.require<PipelineExtractionResult>(POST_ENGINE_CTX.FINAL_RESULT),
  );

  pipeline
    .add(new MergeBaselineWithSlmStep())          
    .add(new RecoverOcrFieldsStep())               
    .add(new ValidateFieldsStep())                 
    .add(new ComputeFieldDiagnosticsStep())        
    .add(new EnrichComplianceStep(deps.complianceEnricher)) 
    .add(new AssessConfidenceStep())               
    .add(new ResolveProvenanceStep())              
    .add(new BuildExtractionResultStep());         

  return pipeline;
}
