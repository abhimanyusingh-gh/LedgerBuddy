import type { PipelineContext } from "./PipelineContext.js";

export interface StageResult {
  status?: "continue" | "skip" | "halt";
}

export interface PipelineStage {
  readonly name: string;
  execute(ctx: PipelineContext): Promise<StageResult>;
}
