import type { PipelineStage } from "./PipelineStage.js";
import type { PipelineInput, PipelineContext } from "./PipelineContext.js";
import { ContextStore } from "./PipelineContext.js";
import type { PipelineResult } from "./PipelineResult.js";

export class ComposablePipeline<T> {
  private stages: PipelineStage[] = [];
  private outputExtractor: (ctx: PipelineContext) => T;

  constructor(outputExtractor: (ctx: PipelineContext) => T) {
    this.outputExtractor = outputExtractor;
  }

  add(stage: PipelineStage): this {
    this.stages.push(stage);
    return this;
  }

  addIf(condition: boolean, stage: PipelineStage | (() => PipelineStage)): this {
    if (condition) {
      this.stages.push(typeof stage === "function" ? stage() : stage);
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
    const stagesExecuted: string[] = [];
    const start = performance.now();

    for (const stage of this.stages) {
      const stageStart = performance.now();
      try {
        const result = await stage.execute(ctx);
        stagesExecuted.push(stage.name);
        ctx.metadata[`stage.${stage.name}.ms`] = (performance.now() - stageStart).toFixed(0);

        if (result.status === "halt") {
          break;
        }
      } catch (error) {
        ctx.metadata[`stage.${stage.name}.error`] = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }

    return {
      output: this.outputExtractor(ctx),
      metadata: ctx.metadata,
      issues: ctx.issues,
      stagesExecuted,
      durationMs: performance.now() - start,
    };
  }
}
