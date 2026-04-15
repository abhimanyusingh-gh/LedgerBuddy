import type { PipelineStep } from "@/core/pipeline/PipelineStep.js";
import type { PipelineInput, PipelineContext } from "@/core/pipeline/PipelineContext.js";
import { ContextStore } from "@/core/pipeline/PipelineContext.js";
import type { PipelineResult } from "@/core/pipeline/PipelineResult.js";

export class ComposablePipeline<T> {
  private steps: PipelineStep[] = [];
  private outputExtractor: (ctx: PipelineContext) => T;

  constructor(outputExtractor: (ctx: PipelineContext) => T) {
    this.outputExtractor = outputExtractor;
  }

  add(step: PipelineStep): this {
    this.steps.push(step);
    return this;
  }

  addIf(condition: boolean, step: PipelineStep | (() => PipelineStep)): this {
    if (condition) {
      this.steps.push(typeof step === "function" ? step() : step);
    }
    return this;
  }

  async execute(input: PipelineInput): Promise<PipelineResult<T>> {
    const ctx: PipelineContext = {
      input,
      store: new ContextStore(),
      metadata: {},
      issues: [],
    };

    return this.executeWithContext(ctx);
  }

  async executeWithContext(ctx: PipelineContext): Promise<PipelineResult<T>> {
    const stepsExecuted: string[] = [];
    const start = performance.now();

    for (const step of this.steps) {
      const stepStart = performance.now();
      try {
        const result = await step.execute(ctx);
        stepsExecuted.push(step.name);
        ctx.metadata[`step.${step.name}.ms`] = (performance.now() - stepStart).toFixed(0);

        if (result.status === "halt") {
          break;
        }
      } catch (error) {
        ctx.metadata[`step.${step.name}.error`] = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    return {
      output: this.outputExtractor(ctx),
      metadata: ctx.metadata,
      issues: ctx.issues,
      stepsExecuted,
      durationMs: performance.now() - start,
    };
  }
}
