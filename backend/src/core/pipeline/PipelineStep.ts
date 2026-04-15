import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { PipelineStepStatus } from "@/types/pipeline.js";

export interface StepOutput {
  status?: PipelineStepStatus;
}

export interface PipelineStep {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<StepOutput>;
}
