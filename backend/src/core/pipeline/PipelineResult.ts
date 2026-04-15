export interface PipelineResult<T> {
  output: T;
  metadata: Record<string, string>;
  issues: string[];
  stepsExecuted: string[];
  durationMs: number;
}
