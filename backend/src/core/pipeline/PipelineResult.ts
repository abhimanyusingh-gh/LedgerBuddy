import type { PipelineStep } from "@/core/pipeline/PipelineStep.js";

export interface PipelineResult<T> {
  output: T;
  metadata: Record<string, string>;
  issues: string[];
  stepsExecuted: PipelineStep[];
  durationMs: number;
}
