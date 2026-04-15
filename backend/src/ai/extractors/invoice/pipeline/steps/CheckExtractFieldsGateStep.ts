import type { PipelineStep, StepOutput } from "@/core/pipeline/PipelineStep.js";
import type { PipelineContext } from "@/core/pipeline/PipelineContext.js";
import type { ExtractedField } from "@/core/interfaces/OcrProvider.js";
import { INVOICE_CTX } from "@/ai/extractors/invoice/pipeline/contextKeys.js";

/**
 * Gate stage inserted between stage 5 (detect-language) and stage 6 (baseline-text-parse).
 * When LlamaExtract has already produced structured fields, the remaining afterOcr
 * stages (baseline parse, augment prompt, set validation context) are unnecessary.
 * This stage halts the pipeline in that case.
 */
export class CheckExtractFieldsGateStep implements PipelineStep {
  readonly name = "check-extract-fields-gate";

  constructor(private readonly llamaExtractEnabled: boolean) {}

  async execute(ctx: PipelineContext): Promise<StepOutput> {
    const extractFields = ctx.store.get<ExtractedField[]>(INVOICE_CTX.EXTRACT_FIELDS);

    if ((extractFields?.length ?? 0) > 0) {
      return { status: "halt" };
    }

    if (this.llamaExtractEnabled) {
      ctx.issues.push("LlamaExtract returned no structured fields.");
      return { status: "halt" };
    }

    return {};
  }
}
