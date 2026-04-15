import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";

export interface StepOutput {
  status?: "continue" | "skip" | "halt";
}

export interface PipelineStep {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<StepOutput>;
}
