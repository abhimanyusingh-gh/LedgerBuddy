import { traceSpan } from "@/utils/traceSpan.js";

const TRACER = "ledgerbuddy-pipeline";

export function tracePipelineStep<T>(stepName: string, fn: () => Promise<T>): Promise<T> {
  return traceSpan(
    {
      tracerName: TRACER,
      spanName: `pipeline.step.${stepName}`,
      attributes: { "step.name": stepName },
      timed: true,
      timingKey: "step.duration_ms",
      onSuccess: () => ({ "step.status": "continue" }),
    },
    fn,
  );
}

export function tracePipelineExecution<T>(pipelineName: string, fn: () => Promise<T>): Promise<T> {
  return traceSpan(
    {
      tracerName: TRACER,
      spanName: "pipeline.execute",
      attributes: { "pipeline.name": pipelineName },
    },
    fn,
  );
}
