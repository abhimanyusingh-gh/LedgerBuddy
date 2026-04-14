export interface PipelineResult<T> {
  output: T;
  metadata: Record<string, string>;
  issues: string[];
  stagesExecuted: string[];
  durationMs: number;
}
